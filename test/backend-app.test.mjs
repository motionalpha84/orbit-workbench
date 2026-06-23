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

test('POST /api/scene-render-data returns drawable scene data', async () => {
  const app = createBackendApp({ logger: false });
  const orbitResponse = await app.inject({
    method: 'POST',
    url: '/api/orbit',
    payload: {
      id: 'orbit-1',
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
  const orbit = orbitResponse.json().data;
  const response = await app.inject({
    method: 'POST',
    url: '/api/scene-render-data',
    payload: { orbits: [orbit], elapsedSeconds: 10 },
  });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().data.orbits[0].id, 'orbit-1');
});

test('ground-track API returns render data, stats, and CSV', async () => {
  const app = createBackendApp({ logger: false });
  const orbitResponse = await app.inject({
    method: 'POST',
    url: '/api/orbit',
    payload: {
      id: 'orbit-1',
      elements: {
        name: 'API Orbit',
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 30,
        raanDeg: 0,
        argPeriapsisDeg: 0,
        trueAnomalyDeg: 0,
      },
    },
  });
  const orbit = orbitResponse.json().data;
  const renderResponse = await app.inject({
    method: 'POST',
    url: '/api/ground-track-render-data',
    payload: { orbits: [orbit], elapsedSeconds: 30 },
  });
  const tracks = renderResponse.json().data.tracks;
  const statsResponse = await app.inject({
    method: 'POST',
    url: '/api/ground-track-region-stats',
    payload: {
      tracks,
      bounds: { westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90 },
    },
  });
  const csvResponse = await app.inject({
    method: 'POST',
    url: '/api/ground-track-csv',
    payload: { tracks },
  });
  await app.close();

  assert.equal(renderResponse.statusCode, 200);
  assert.equal(statsResponse.json().data.totalOrbitCount, 1);
  assert.equal(csvResponse.headers['content-type'].startsWith('text/csv'), true);
  assert.match(csvResponse.body, /API Orbit/);
});
