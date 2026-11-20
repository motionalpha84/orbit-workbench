import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServer } from '../server.mjs';

const record = {
  id: 'preview-contract-orbit',
  name: 'Preview contract',
  visible: true,
  color: '#7fe8d2',
  elements: {
    semiMajorAxisKm: 12000,
    eccentricity: 0.22,
    inclinationDeg: 63.4,
    raanDeg: 36,
    argPeriapsisDeg: 14,
    trueAnomalyDeg: 22,
  },
};

let application;
let baseUrl;

before(async () => {
  application = createWorkbenchServer({ workers: 2 });
  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
});

after(async () => { await application?.close(); });

async function compute(type, payload) {
  const response = await fetch(`${baseUrl}/api/compute/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

function assertFiniteVector(vector, label) {
  assert.ok(vector && typeof vector === 'object', `${label} is present`);
  for (const axis of ['x', 'y', 'z']) {
    assert.equal(typeof vector[axis], 'number', `${label}.${axis} is numeric`);
    assert.ok(Number.isFinite(vector[axis]), `${label}.${axis} is finite`);
  }
}

test('production HTML, stylesheet and entry module are served by the local application', async () => {
  const assets = [
    ['/index.html', 'text/html', /<!doctype html>/i],
    ['/styles.css', 'text/css', /FIREFLY/],
    ['/js/i18n-dict.mjs', 'text/javascript', /DICT_ENTRIES/],
    ['/assets/fonts/chakra-petch-700.woff2', 'font/woff2', /wOF2/],
    ['/js/app.mjs', 'text/javascript', /WireRecordCache/],
  ];
  for (const [path, mimeType, content] of assets) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type')?.startsWith(mimeType), `${path} content type`);
    assert.match(await response.text(), content, `${path} content`);
  }
});

for (const perturbationModel of ['two-body', 'j2', 'j3']) {
  test(`${perturbationModel} preview preparation and playback return consistent real worker results`, async () => {
    const elapsedSeconds = 5432;
    const payload = { records: [record], perturbationModel, elapsedSeconds };
    const prepared = await compute('prepare', { ...payload, referenceSampleCount: 48 });
    assert.equal(prepared.response.status, 200, JSON.stringify(prepared.body));
    assert.ok(prepared.response.headers.get('x-compute-job'));
    assert.equal(prepared.body.perturbationModel, perturbationModel);
    assert.equal(prepared.body.records.length, 1);
    const preparedRecord = prepared.body.records[0];
    assert.equal(preparedRecord.id, record.id);
    assert.ok(Number.isFinite(preparedRecord.orbit.periodSeconds) && preparedRecord.orbit.periodSeconds > 0);
    assert.equal(preparedRecord.reference.length, 48);
    for (const sample of preparedRecord.reference) {
      assertFiniteVector(sample.positionKm, 'reference.positionKm');
      assert.ok(Number.isFinite(sample.elapsedSeconds));
    }

    const frame = await compute('frame', { ...payload, trailCount: 4 });
    assert.equal(frame.response.status, 200, JSON.stringify(frame.body));
    assert.ok(frame.response.headers.get('x-compute-job'));
    assert.equal(frame.body.elapsedSeconds, elapsedSeconds);
    assert.equal(frame.body.perturbationModel, perturbationModel);
    assert.equal(frame.body.records.length, 1);
    const computedRecord = frame.body.records[0];
    assert.equal(computedRecord.id, record.id);
    assertFiniteVector(computedRecord.state.positionKm, 'state.positionKm');
    assertFiniteVector(computedRecord.state.velocityKmS, 'state.velocityKmS');
    assert.equal(computedRecord.state.perturbationModel, perturbationModel);
    assert.equal(computedRecord.state.elapsedSeconds, elapsedSeconds);
    assert.deepEqual(computedRecord.state, preparedRecord.initialState);
    assert.equal(computedRecord.trail.length, 4);
    computedRecord.trail.forEach(point => assertFiniteVector(point, 'trail'));
    assert.deepEqual(computedRecord.trail.at(-1), computedRecord.state.positionKm);
    assert.notDeepEqual(computedRecord.trail[0], computedRecord.trail.at(-1));
  });
}

test('preview compute endpoints reject invalid orbital elements with HTTP 422', async () => {
  for (const type of ['prepare', 'frame']) {
    for (const elements of [
      { ...record.elements, eccentricity: 1 },
      { ...record.elements, semiMajorAxisKm: 6000, eccentricity: 0 },
    ]) {
      const result = await compute(type, { records: [{ ...record, elements }] });
      assert.equal(result.response.status, 422, `${type} rejects invalid elements`);
      assert.equal(typeof result.body.error, 'string');
      assert.ok(result.body.error.length > 0);
    }
  }
});
