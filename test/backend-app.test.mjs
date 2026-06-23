import test from 'node:test';
import assert from 'node:assert/strict';

import { createBackendApp } from '../backend/app.mjs';

test('GET / returns backend health status', async () => {
  const app = createBackendApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/' });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    service: 'orbit-api',
    version: 1,
  });
});

test('unknown API routes return structured 404', async () => {
  const app = createBackendApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/missing' });
  await app.close();

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, 'NOT_FOUND');
});

test('known POST route called with GET returns structured 405', async () => {
  const app = createBackendApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/orbit' });
  await app.close();

  assert.equal(response.statusCode, 405);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, 'METHOD_NOT_ALLOWED');
});

test('POST /api/orbit returns computed orbit data', async () => {
  const app = createBackendApp({ logger: false });
  const response = await app.inject({
    method: 'POST',
    url: '/api/orbit',
    payload: {
      id: 'orbit-1',
      color: '#568c87',
      elements: {
        name: 'API Orbit',
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 0,
        raanDeg: 0,
        argPeriapsisDeg: 0,
        trueAnomalyDeg: 0,
      },
    },
  });
  await app.close();

  const payload = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, 'orbit-1');
  assert.equal(payload.data.metrics.initialPositionKm.x, 7000);
});
