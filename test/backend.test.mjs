import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServer } from '../server.mjs';
import { computeOrbit, propagateOrbit, sampleOrbit } from '../js/orbit.mjs';
import { calibrateOrbitVectorTargets } from '../js/vector-calibration.mjs';

const elements = { name: 'Backend reference', semiMajorAxisKm: 12000, eccentricity: 0.22, inclinationDeg: 63.4, raanDeg: 36, argPeriapsisDeg: 14, trueAnomalyDeg: 22 };
const record = { id: 'reference-orbit', elements, color: '#7be8d2', visible: true };
let app;
let base;

before(async () => {
  app = createWorkbenchServer({ workers: 2 });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); });

async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
async function complete(id) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await request(`/api/jobs/${id}`);
    if (['completed', 'failed', 'cancelled'].includes(response.data.status)) return response.data;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('Task did not finish');
}

test('health reports real worker capacity and static server protects private files', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.workers, 2);
  assert.equal(health.data.architecture, 'worker_threads');
  assert.equal(health.data.limits.records, 5000);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<!doctype html>/i);
  for (const path of ['/server.mjs', '/server/worker.mjs', '/package.json', '/.git/config', '/assets/%2e%2e%2fserver.mjs']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/%GG`)).status, 400);
  assert.equal((await fetch(`${base}/js/orbit.mjs`, { method: 'HEAD' })).status, 200);
});

test('HTTP validation rejects malformed JSON, foreign origins, duplicate ids and excessive workloads', async () => {
  const malformed = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const foreign = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const wrongType = await fetch(`${base}/api/jobs`, { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  assert.equal((await request('/api/jobs', { type: 'prepare', payload: { records: [record, record] } })).status, 422);
  assert.equal((await request('/api/jobs', { type: 'prepare', payload: { records: [{ ...record, elements: { ...elements, eccentricity: 1 } }] } })).status, 422);
  assert.equal((await request('/api/compute/ephemeris', { records: [record, { ...record, id: 'two' }], sampleCount: 100_000 })).status, 422);
  assert.equal((await request('/api/jobs', { type: 'prepare', payload: { records: [record], referenceSampleCount: 0 } })).status, 422);
});

for (const perturbationModel of ['two-body', 'j2', 'j3']) {
  test(`worker preparation, ephemeris and playback exactly match the shared ${perturbationModel} kernel`, async () => {
    const orbit = computeOrbit(elements);
    const elapsedSeconds = 5432;
    const options = { perturbationModel };
    const submitted = await request('/api/jobs', { type: 'prepare', payload: { records: [record], perturbationModel, elapsedSeconds, referenceSampleCount: 120 } });
    assert.equal(submitted.status, 202);
    const finished = await complete(submitted.data.id);
    assert.equal(finished.status, 'completed', finished.error);
    assert.equal(finished.progress, 1);
    const prepared = (await request(`/api/jobs/${finished.id}/result`)).data;
    const result = prepared.records[0];
    assert.equal(result.orbit.periodSeconds, orbit.periodSeconds);
    assert.deepEqual(result.initialState, propagateOrbit(orbit, elapsedSeconds, options));
    assert.deepEqual(result.reference, sampleOrbit(orbit, 120, options).map(({ positionKm, elapsedSeconds: time }) => ({ positionKm, elapsedSeconds: time })));
    const frame = await request('/api/compute/frame', { records: [record], perturbationModel, elapsedSeconds, trailCount: 4 });
    assert.equal(frame.status, 200);
    assert.deepEqual(frame.data.records[0].state, propagateOrbit(orbit, elapsedSeconds, options));
    const span = Math.min(orbit.periodSeconds * 0.22, Math.max(420, orbit.periodSeconds * 0.1));
    const expectedTrail = Array.from({ length: 4 }, (_, index) => propagateOrbit(orbit, elapsedSeconds - span * (1 - index / 3), options).positionKm);
    assert.deepEqual(frame.data.records[0].trail, expectedTrail);
    const ephemeris = await request('/api/compute/ephemeris', { records: [record], times: [-10, 0, 600, 123456], perturbationModel });
    assert.deepEqual(ephemeris.data.records[0].states, [-10, 0, 600, 123456].map((time) => propagateOrbit(orbit, time, options)));
  });
}

test('hidden orbits retain metric states without computing decorative trails', async () => {
  const frame = await request('/api/compute/frame', { records: [{ ...record, visible: false }], elapsedSeconds: 5, trailCount: 130 });
  assert.equal(frame.status, 200);
  assert.deepEqual(frame.data.records[0].trail, []);
  assert.deepEqual(frame.data.records[0].state, propagateOrbit(computeOrbit(elements), 5));
});

test('server ground-track session preserves history, individual resets and explicit reset tokens', async () => {
  const records = [record, { ...record, id: 'second' }];
  const groundTrack = { sessionId: 'ground-history-test', resetToken: 'first', startUtcMs: 1704067200000, referenceSampleCount: 120, window: { mode: 'time', pastSeconds: 10000 } };
  const first = await request('/api/compute/frame', { records, elapsedSeconds: 1000, trailCount: 0, groundTrack });
  assert.equal(first.status, 200);
  assert.equal(first.data.tracks[0].points[0].elapsedSeconds, 1000);
  const later = await request('/api/compute/frame', { records, elapsedSeconds: 1600, trailCount: 0, groundTrack });
  assert.equal(later.data.groundTrack.reset, false);
  assert.equal(later.data.tracks[0].points[0].elapsedSeconds, 1000);
  assert.ok(later.data.tracks[0].points.length > 2);
  const oneReset = await request('/api/compute/frame', { records, elapsedSeconds: 1800, trailCount: 0, groundTrack: { ...groundTrack, resetIds: ['reference-orbit'] } });
  assert.equal(oneReset.data.tracks[0].points[0].elapsedSeconds, 1800);
  assert.equal(oneReset.data.tracks[1].points[0].elapsedSeconds, 1000);
  const globalReset = await request('/api/compute/frame', { records, elapsedSeconds: 1900, trailCount: 0, groundTrack: { ...groundTrack, resetToken: 'second' } });
  assert.equal(globalReset.data.groundTrack.reset, true);
  assert.equal(globalReset.data.tracks[1].points[0].elapsedSeconds, 1900);
});

test('worker vector calibration retains exact multi-target results', async () => {
  const orbit = computeOrbit(elements);
  const current = propagateOrbit(orbit, 2200, { perturbationModel: 'j2' });
  const targets = [
    { id: 'position', name: 'Position', mode: 'position', vector: current.positionKm },
    { id: 'velocity', name: 'Velocity', mode: 'velocity', vector: current.velocityKmS },
  ];
  const options = { targets, sampleCount: 240, perturbationModel: 'j2' };
  const response = await request('/api/compute/calibration', { records: [record], ...options });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, calibrateOrbitVectorTargets([{ ...record, name: elements.name, orbit }], options));
});

test('large compute runs off the event loop and can be cancelled without blocking health or the next frame', async () => {
  const records = Array.from({ length: 1000 }, (_, index) => ({ ...record, id: `stress-${index}`, elements: { ...elements, raanDeg: index % 360 } }));
  const response = await request('/api/jobs', { type: 'prepare', payload: { records, referenceSampleCount: 6000, perturbationModel: 'j3' } });
  assert.equal(response.status, 202);
  const started = performance.now();
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.ok(performance.now() - started < 1000, 'HTTP health must stay responsive while worker calculates');
  const cancelled = await request(`/api/jobs/${response.data.id}`, undefined, 'DELETE');
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal((await request(`/api/jobs/${response.data.id}/result`)).status, 410);
  const frame = await request('/api/compute/frame', { records: [record], elapsedSeconds: 20, trailCount: 2 });
  assert.equal(frame.status, 200);
  assert.equal(frame.data.records.length, 1);
});

test('unexpected worker exit fails its task and replaces the worker', async () => {
  const records = Array.from({ length: 300 }, (_, index) => ({ ...record, id: `restart-${index}` }));
  const submitted = await request('/api/jobs', { type: 'prepare', payload: { records } });
  const slot = app.pool.slots.find((entry) => entry?.job?.id === submitted.data.id);
  assert.ok(slot);
  await slot.worker.terminate();
  const finished = await complete(submitted.data.id);
  assert.equal(finished.status, 'failed');
  const next = await request('/api/compute/frame', { records: [record], elapsedSeconds: 20, trailCount: 0 });
  assert.equal(next.status, 200);
});

test('bounded queue rejects excess work and queued cancellation never reaches a worker', async () => {
  const isolated = createWorkbenchServer({ workers: 1, poolOptions: { maxQueue: 1 } });
  await new Promise((resolve) => isolated.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.server.address().port}`;
  try {
    const records = Array.from({ length: 1000 }, (_, index) => ({ ...record, id: `queue-${index}` }));
    const submit = async () => {
      const response = await fetch(`${url}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'prepare', payload: { records, perturbationModel: 'j3' } }) });
      return { status: response.status, data: await response.json() };
    };
    const running = await submit();
    const queued = await submit();
    assert.equal(running.data.status, 'running');
    assert.equal(queued.data.status, 'queued');
    assert.equal((await submit()).status, 429);
    const cancelResponse = await fetch(`${url}/api/jobs/${queued.data.id}`, { method: 'DELETE' });
    const cancelled = await cancelResponse.json();
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.startedAt, null);
    await fetch(`${url}/api/jobs/${running.data.id}`, { method: 'DELETE' });
  } finally { await isolated.close(); }
});
