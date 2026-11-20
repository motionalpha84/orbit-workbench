import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServer } from '../server.mjs';
import { computeOrbit, propagateOrbit } from '../js/orbit.mjs';
import { encodeFrame, decodeFrame, FRAME_MIME } from '../js/frame-codec.mjs';
import { BackendClient } from '../js/backend-client.mjs';

const record = { id: 'dataset-orbit', name: '高精度基线', color: '#7fe8d2', visible: true,
  elements: { semiMajorAxisKm: 12000.123456789012, eccentricity: 0.22123456789012345,
    inclinationDeg: 63.45678901234567, raanDeg: 36.12345678901234,
    argPeriapsisDeg: 14.123456789012345, trueAnomalyDeg: 22.123456789012345 } };
let app;
let base;
let now = Date.now();
before(async () => {
  app = createWorkbenchServer({ workers: 1, datasetOptions: { now: () => now, ttlMs: 1000, maxDatasets: 4 } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); });

async function request(path, body, { method = body === undefined ? 'GET' : 'POST', compact = false } = {}) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(compact ? { Accept: FRAME_MIME } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const binary = response.headers.get('content-type') === FRAME_MIME;
  const data = binary ? decodeFrame(await response.arrayBuffer()) : await response.json();
  return { status: response.status, data, headers: response.headers };
}
async function register(records = [record]) {
  const response = await request('/api/datasets', { records });
  assert.equal(response.status, 201);
  return { datasetId: response.data.datasetId, revision: response.data.revision };
}

for (const perturbationModel of ['two-body', 'j2', 'j3']) {
  test(`versioned dataset and Float64 frame retain every ${perturbationModel} legacy state field`, async () => {
    const records = [record, { ...record, id: 'hidden', visible: false }];
    const dataset = await register(records);
    const options = { elapsedSeconds: 5432.123456789, trailCount: 7, perturbationModel };
    const legacy = await request('/api/compute/frame', { records, ...options });
    const compact = await request('/api/compute/frame', { ...dataset, ...options }, { compact: true });
    assert.equal(compact.status, 200);
    assert.equal(compact.headers.get('content-type'), FRAME_MIME);
    assert.deepEqual(compact.data, legacy.data);
    assert.deepEqual(compact.data.records[1].trail, []);
    const warm = await request('/api/compute/frame', { ...dataset, ...options }, { compact: true });
    assert.equal(warm.headers.get('x-dataset-cache'), 'hit');
    assert.deepEqual(warm.data, compact.data);
    assert.ok(Number(compact.headers.get('content-length')) < Number(legacy.headers.get('content-length')) * 0.6);
  });
}

test('reference cache reuses sampling and invalidates by model and sample budget', async () => {
  const dataset = await register();
  const options = { ...dataset, perturbationModel: 'j3', referenceSampleCount: 127 };
  const first = await request('/api/compute/prepare', options);
  const cached = await request('/api/compute/prepare', options);
  assert.deepEqual(cached.data, first.data);
  assert.equal(cached.headers.get('x-reference-cache-hits'), '1');
  const changedBudget = await request('/api/compute/prepare', { ...options, referenceSampleCount: 129 });
  assert.equal(changedBudget.headers.get('x-reference-cache-hits'), '0');
  assert.equal(changedBudget.data.records[0].reference.length, 129);
  const changedModel = await request('/api/compute/prepare', { ...options, perturbationModel: 'two-body' });
  assert.equal(changedModel.headers.get('x-reference-cache-hits'), '0');
  assert.notDeepEqual(changedModel.data.records[0].reference, first.data.records[0].reference);
});

test('dataset updates use compare-and-swap and reject invalid or stale versions', async () => {
  const dataset = await register();
  const changed = { ...record, elements: { ...record.elements, semiMajorAxisKm: 14000 } };
  const update = await request(`/api/datasets/${dataset.datasetId}`, { revision: 1, records: [changed] }, { method: 'PUT' });
  assert.equal(update.data.revision, 2);
  assert.equal((await request('/api/compute/frame', dataset)).status, 409);
  assert.equal((await request(`/api/datasets/${dataset.datasetId}`, { revision: 1, records: [record] }, { method: 'PUT' })).status, 409);
  assert.equal((await request('/api/compute/frame', { datasetId: dataset.datasetId })).status, 422);
  assert.equal((await request('/api/compute/frame', { ...dataset, revision: 2, records: [] })).status, 422);
  const current = await request('/api/compute/frame', { ...dataset, revision: 2, trailCount: 0 });
  assert.equal(current.data.records[0].state.elements.semiMajorAxisKm, 14000);
  assert.equal((await request('/api/datasets', { records: [{ ...record, elements: { ...record.elements, eccentricity: 1 } }] })).status, 422);
});

test('queued tasks retain the submitted immutable dataset revision', async () => {
  const dataset = await register();
  const blocker = await request('/api/jobs', { type: 'prepare', payload: { perturbationModel: 'j3',
    records: Array.from({ length: 700 }, (_, index) => ({ ...record, id: `block-${index}`, name: `block-${index}`, elements: { ...record.elements, raanDeg: index / 2 } })),
  } });
  const submitted = await request('/api/jobs', { type: 'frame', payload: { ...dataset, elapsedSeconds: 20, trailCount: 0 } });
  assert.equal(submitted.status, 202);
  const changed = { ...record, elements: { ...record.elements, semiMajorAxisKm: 15000 } };
  await request(`/api/datasets/${dataset.datasetId}`, { revision: 1, records: [changed] }, { method: 'PUT' });
  await request(`/api/jobs/${blocker.data.id}`, undefined, { method: 'DELETE' });
  const completed = await app.pool.wait(submitted.data.id);
  const result = JSON.parse(completed.resultJson);
  assert.deepEqual(result.records[0].state, JSON.parse(JSON.stringify(propagateOrbit(computeOrbit({ ...record.elements, name: record.name }), 20))));
});

test('compact frames preserve all ground history, filters and reset semantics', async () => {
  const records = [record, { ...record, id: 'second-ground' }];
  const dataset = await register(records);
  const common = { startUtcMs: 1704067200000, referenceSampleCount: 120, window: { mode: 'revs', pastRevs: 2 } };
  for (const [index, elapsedSeconds] of [1000, 5000, 9000, 13000, 15000].entries()) {
    const controls = index === 2 ? { activeIds: [record.id] } : index === 3 ? { resetIds: [record.id] } : index === 4 ? { resetToken: 'reset-all' } : {};
    const legacy = await request('/api/compute/frame', { records, elapsedSeconds, trailCount: 3,
      groundTrack: { ...common, ...controls, sessionId: 'legacy-ground' } });
    const compact = await request('/api/compute/frame', { ...dataset, elapsedSeconds, trailCount: 3,
      groundTrack: { ...common, ...controls, sessionId: 'compact-ground' } }, { compact: true });
    assert.equal(compact.status, 200);
    legacy.data.groundTrack.sessionId = compact.data.groundTrack.sessionId;
    assert.deepEqual(compact.data, legacy.data);
  }
});

test('worker replacement repopulates dataset cache and registered jobs still cancel', async () => {
  const dataset = await register();
  await request('/api/compute/frame', { ...dataset, trailCount: 0 }, { compact: true });
  await app.pool.slots[0].worker.terminate();
  const restored = await request('/api/compute/frame', { ...dataset, trailCount: 0 }, { compact: true });
  assert.equal(restored.status, 200);
  assert.equal(restored.headers.get('x-dataset-cache'), 'miss');
  const bigDataset = await register(Array.from({ length: 1000 }, (_, index) => ({ ...record, id: `cancel-${index}`,
    name: `cancel-${index}`, elements: { ...record.elements, raanDeg: index } })));
  const submitted = await request('/api/jobs', { type: 'prepare', payload: { ...bigDataset, perturbationModel: 'j3' } });
  const cancelled = await request(`/api/jobs/${submitted.data.id}`, undefined, { method: 'DELETE' });
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal((await request(`/api/jobs/${submitted.data.id}/result`)).status, 410);
  assert.equal((await request('/api/compute/frame', { ...dataset, trailCount: 0 }, { compact: true })).status, 200);
});

test('client uploads immutable records once, renews expired datasets, and decodes Float64 frames', async () => {
  const calls = [];
  const client = new BackendClient({ fetchImpl: (path, options) => {
    calls.push({ path, body: options.body ? JSON.parse(options.body) : null });
    return fetch(`${base}${path}`, options);
  } });
  assert.equal(await client.checkHealth(), true);
  const records = [record];
  const payload = { records, elapsedSeconds: 120.123456789, trailCount: 3 };
  const first = await client.frame(payload);
  const next = await client.frame({ ...payload, elapsedSeconds: 130 });
  assert.equal(next.elapsedSeconds, 130);
  assert.equal(calls.filter(call => call.path === '/api/datasets').length, 1);
  assert.ok(calls.filter(call => call.path === '/api/compute/frame').every(call => !('records' in call.body)));
  now += 1001;
  const recovered = await client.frame(payload);
  assert.deepEqual(recovered, first);
  assert.equal(calls.filter(call => call.path === '/api/datasets').length, 2);
  const changedRecords = [{ ...record, visible: false }];
  assert.deepEqual((await client.frame({ ...payload, records: changedRecords })).records[0].trail, []);
  assert.equal(calls.filter(call => call.path === '/api/datasets').length, 3);
});

test('dataset eviction and deletion are explicit and malformed frame bytes are rejected', async () => {
  const first = await register();
  for (let i = 0; i < 4; i += 1) await register();
  const expired = await request('/api/compute/frame', first);
  assert.equal(expired.status, 410);
  assert.equal(expired.data.code, 'DATASET_EXPIRED');
  const current = await register();
  await request(`/api/datasets/${current.datasetId}`, undefined, { method: 'DELETE' });
  assert.equal((await request('/api/compute/frame', current)).status, 410);
  const frame = { records: [{ id: 'precision', state: { positionKm: { x: Number.MIN_VALUE, y: -0, z: 1 + Number.EPSILON },
    velocityKmS: { x: -1.1234567890123457, y: 2, z: 3 }, customField: 'preserved' }, trail: [] }] };
  const bytes = encodeFrame(frame);
  assert.deepEqual(decodeFrame(bytes), frame);
  assert.throws(() => decodeFrame(bytes.slice(0, -1)), /截断|格式/);
  assert.throws(() => decodeFrame(new Uint8Array(8)), /格式/);
});
