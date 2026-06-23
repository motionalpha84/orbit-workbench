# Backend Render Data Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the orbit workbench into a frontend that handles display and interaction, and a backend that computes orbit, ground-track, and render-data payloads.

**Architecture:** Upgrade `server.mjs` from a static-only server into a static-file plus `/api/*` local HTTP server. Put reusable API contracts in `shared/`, backend route and service logic in `backend/`, and a frontend-only API wrapper in `js/api-client.mjs`. Move the browser away from direct orbit propagation by having `js/app.mjs`, `js/scene.mjs`, and `js/groundtrack-view.mjs` consume backend-generated render data.

**Tech Stack:** Node.js ES modules, Node built-in HTTP server, Node built-in test runner, vanilla browser ES modules, Three.js, Canvas 2D.

---

## File Structure

- Create `shared/contracts.mjs`: API version, supported model/mode constants, response helpers, and input normalization helpers used by backend and frontend.
- Create `backend/http-utils.mjs`: JSON body parsing, JSON/text response helpers, and API error conversion.
- Create `backend/api-router.mjs`: route dispatcher for `/api/orbit`, `/api/scene-render-data`, `/api/ground-track-render-data`, `/api/ground-track-region-stats`, and `/api/ground-track-csv`.
- Create `backend/orbit-service.mjs`: orbit record construction and metrics from raw elements.
- Create `backend/render-data-service.mjs`: 3D render payloads for Earth rotation, frame axes, reference points, playback samples, tail samples, and current points.
- Create `backend/groundtrack-service.mjs`: 2D map render payloads, region stats, and CSV output.
- Create `js/api-client.mjs`: frontend API client with request cancellation and uniform error handling.
- Modify `server.mjs`: delegate `/api/*` requests to `backend/api-router.mjs`, keep static files unchanged.
- Modify `js/scene.mjs`: add render-data ingestion methods and remove direct dependency on `js/orbit.mjs`.
- Modify `js/app.mjs`: use `js/api-client.mjs`, store backend render payloads, and remove direct propagation/ground-track calculation.
- Modify `test/static-files.test.mjs`: enforce frontend/backend responsibility boundaries.
- Create backend/API tests in `test/backend-*.test.mjs` and `test/server-api.test.mjs`.

## Task 1: Shared API Contracts

**Files:**
- Create: `shared/contracts.mjs`
- Test: `test/contracts.test.mjs`

- [ ] **Step 1: Write the failing contract tests**

Create `test/contracts.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_VERSION,
  DEFAULT_GROUND_TRACK_WINDOW,
  SUPPORTED_PERFORMANCE_MODES,
  SUPPORTED_PERTURBATION_MODELS,
  apiError,
  apiOk,
  normalizeFrame,
  normalizeGroundTrackWindow,
  normalizePerformanceOptions,
  normalizePerturbationModelValue,
} from '../shared/contracts.mjs';

test('exports stable API constants', () => {
  assert.equal(API_VERSION, 1);
  assert.deepEqual(SUPPORTED_PERTURBATION_MODELS, ['two-body', 'j2', 'j3']);
  assert.deepEqual(SUPPORTED_PERFORMANCE_MODES, ['power-save', 'balanced', 'high', 'custom']);
  assert.deepEqual(DEFAULT_GROUND_TRACK_WINDOW, {
    mode: 'revs',
    pastRevs: 2,
    pastSeconds: 3600,
    timeUnit: 'min',
  });
});

test('wraps success and error responses consistently', () => {
  assert.deepEqual(apiOk({ value: 42 }), {
    ok: true,
    data: { value: 42 },
  });
  assert.deepEqual(apiError('VALIDATION_ERROR', 'Bad orbit', { field: 'eccentricity' }), {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Bad orbit',
      details: { field: 'eccentricity' },
    },
  });
});

test('normalizes request option values', () => {
  assert.equal(normalizePerturbationModelValue('j2'), 'j2');
  assert.equal(normalizePerturbationModelValue('bad'), 'two-body');
  assert.equal(normalizeFrame('ECEF'), 'ECEF');
  assert.equal(normalizeFrame('bad'), 'ECI');
  assert.deepEqual(normalizePerformanceOptions({ mode: 'custom', memoryGb: 16 }), {
    mode: 'custom',
    memoryGb: 16,
  });
  assert.deepEqual(normalizePerformanceOptions({ mode: 'bad', memoryGb: -3 }), {
    mode: 'balanced',
    memoryGb: 4,
  });
});

test('normalizes ground-track windows', () => {
  assert.deepEqual(
    normalizeGroundTrackWindow({ mode: 'time', pastSeconds: 120, timeUnit: 's' }),
    { mode: 'time', pastRevs: 2, pastSeconds: 120, timeUnit: 's' },
  );
  assert.deepEqual(
    normalizeGroundTrackWindow({ mode: 'revs', pastRevs: 8, pastSeconds: -1, timeUnit: 'bad' }),
    { mode: 'revs', pastRevs: 8, pastSeconds: 3600, timeUnit: 'min' },
  );
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test test\contracts.test.mjs`

Expected: FAIL with `Cannot find module` for `shared/contracts.mjs`.

- [ ] **Step 3: Implement the shared contract module**

Create `shared/contracts.mjs`:

```js
export const API_VERSION = 1;

export const SUPPORTED_PERTURBATION_MODELS = ['two-body', 'j2', 'j3'];
export const SUPPORTED_PERFORMANCE_MODES = ['power-save', 'balanced', 'high', 'custom'];
export const SUPPORTED_FRAMES = ['ECI', 'ECEF'];
export const SUPPORTED_TIME_UNITS = ['s', 'min', 'hr', 'day'];

export const DEFAULT_PERFORMANCE_OPTIONS = {
  mode: 'balanced',
  memoryGb: 4,
};

export const DEFAULT_GROUND_TRACK_WINDOW = {
  mode: 'revs',
  pastRevs: 2,
  pastSeconds: 3600,
  timeUnit: 'min',
};

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function apiOk(data) {
  return { ok: true, data };
}

export function apiError(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
}

export function normalizePerturbationModelValue(value) {
  return SUPPORTED_PERTURBATION_MODELS.includes(value) ? value : 'two-body';
}

export function normalizeFrame(value) {
  return value === 'ECEF' ? 'ECEF' : 'ECI';
}

export function normalizePerformanceOptions(value = {}) {
  const mode = SUPPORTED_PERFORMANCE_MODES.includes(value.mode)
    ? value.mode
    : DEFAULT_PERFORMANCE_OPTIONS.mode;
  return {
    mode,
    memoryGb: Math.max(1, Math.min(24, finiteNumber(value.memoryGb, DEFAULT_PERFORMANCE_OPTIONS.memoryGb))),
  };
}

export function normalizeGroundTrackWindow(value = {}) {
  const mode = value.mode === 'time' ? 'time' : 'revs';
  const timeUnit = SUPPORTED_TIME_UNITS.includes(value.timeUnit)
    ? value.timeUnit
    : DEFAULT_GROUND_TRACK_WINDOW.timeUnit;
  return {
    mode,
    pastRevs: Math.max(0, Math.floor(finiteNumber(value.pastRevs, DEFAULT_GROUND_TRACK_WINDOW.pastRevs))),
    pastSeconds: Math.max(0, finiteNumber(value.pastSeconds, DEFAULT_GROUND_TRACK_WINDOW.pastSeconds)),
    timeUnit,
  };
}
```

- [ ] **Step 4: Run the contract test and verify it passes**

Run: `node --test test\contracts.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/contracts.mjs test/contracts.test.mjs
git commit -m "feat: add shared API contracts"
```

## Task 2: Backend HTTP Utilities and API Router Skeleton

**Files:**
- Create: `backend/http-utils.mjs`
- Create: `backend/api-router.mjs`
- Modify: `server.mjs`
- Test: `test/api-router.test.mjs`

- [ ] **Step 1: Write failing router tests**

Create `test/api-router.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { handleApiRequest } from '../backend/api-router.mjs';

function request({ method = 'GET', url = '/api/missing', body = null } = {}) {
  const stream = Readable.from(body === null ? [] : [body]);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    'content-type': 'application/json',
  };
  return stream;
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    },
  };
}

test('returns structured 404 for unknown API route', async () => {
  const res = response();
  const handled = await handleApiRequest(request(), res);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(JSON.parse(res.body), {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'API route not found: /api/missing',
      details: { path: '/api/missing' },
    },
  });
});

test('returns structured method error for non-POST endpoint calls', async () => {
  const res = response();
  const handled = await handleApiRequest(request({ method: 'GET', url: '/api/orbit' }), res);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).error.code, 'METHOD_NOT_ALLOWED');
});
```

- [ ] **Step 2: Run the router test and verify it fails**

Run: `node --test test\api-router.test.mjs`

Expected: FAIL with `Cannot find module` for `backend/api-router.mjs`.

- [ ] **Step 3: Implement HTTP utilities**

Create `backend/http-utils.mjs`:

```js
import { apiError, apiOk } from '../shared/contracts.mjs';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export class ApiRequestError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      throw new ApiRequestError(413, 'PAYLOAD_TOO_LARGE', 'JSON request body is too large.', {
        maxBytes: MAX_JSON_BYTES,
      });
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiRequestError(400, 'BAD_JSON', 'Request body must be valid JSON.');
  }
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  response.end(JSON.stringify(payload));
}

export function sendOk(response, data, statusCode = 200) {
  sendJson(response, statusCode, apiOk(data));
}

export function sendError(response, statusCode, code, message, details = {}) {
  sendJson(response, statusCode, apiError(code, message, details));
}

export function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  response.end(text);
}

export function sendCaughtError(response, error) {
  if (error instanceof ApiRequestError) {
    sendError(response, error.statusCode, error.code, error.message, error.details);
    return;
  }
  sendError(response, 500, 'INTERNAL_ERROR', error?.message || 'Internal server error.');
}
```

- [ ] **Step 4: Implement the router skeleton**

Create `backend/api-router.mjs`:

```js
import { ApiRequestError, readJsonBody, sendCaughtError, sendError } from './http-utils.mjs';

const POST_ROUTES = new Set([
  '/api/orbit',
  '/api/scene-render-data',
  '/api/ground-track-render-data',
  '/api/ground-track-region-stats',
  '/api/ground-track-csv',
]);

function apiPath(request) {
  return new URL(request.url || '/', 'http://127.0.0.1').pathname;
}

function assertPost(request, path) {
  if (POST_ROUTES.has(path) && request.method !== 'POST') {
    throw new ApiRequestError(405, 'METHOD_NOT_ALLOWED', `${path} requires POST.`, {
      method: request.method,
      path,
    });
  }
}

export async function handleApiRequest(request, response) {
  const path = apiPath(request);
  if (!path.startsWith('/api/')) return false;

  try {
    assertPost(request, path);
    if (POST_ROUTES.has(path)) {
      await readJsonBody(request);
      sendError(response, 501, 'NOT_IMPLEMENTED', `API route is not implemented yet: ${path}`, { path });
      return true;
    }
    sendError(response, 404, 'NOT_FOUND', `API route not found: ${path}`, { path });
    return true;
  } catch (error) {
    sendCaughtError(response, error);
    return true;
  }
}
```

- [ ] **Step 5: Modify the static server to call the router first**

Modify the top imports in `server.mjs`:

```js
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import { handleApiRequest } from './backend/api-router.mjs';
```

Replace the `createServer` callback with:

```js
const server = createServer(async (request, response) => {
  if (await handleApiRequest(request, response)) return;

  const filePath = safePath(request.url || '/');
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(filePath).pipe(response);
});
```

- [ ] **Step 6: Run router tests and static tests**

Run: `node --test test\api-router.test.mjs test\static-files.test.mjs`

Expected: PASS. The API endpoints return `NOT_IMPLEMENTED` for known POST routes at this task, and existing static-file tests remain green.

- [ ] **Step 7: Commit**

```bash
git add backend/http-utils.mjs backend/api-router.mjs server.mjs test/api-router.test.mjs
git commit -m "feat: route local API requests"
```

## Task 3: Backend Orbit Service

**Files:**
- Create: `backend/orbit-service.mjs`
- Modify: `backend/api-router.mjs`
- Test: `test/backend-orbit-service.test.mjs`
- Test: `test/api-router.test.mjs`

- [ ] **Step 1: Write failing orbit service tests**

Create `test/backend-orbit-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/orbit-service.mjs';

test('creates an orbit record with metrics and initial state', () => {
  const record = createOrbitRecord({
    elements: {
      name: 'LEO-01',
      semiMajorAxisKm: 7000,
      eccentricity: 0,
      inclinationDeg: 0,
      raanDeg: 0,
      argPeriapsisDeg: 0,
      trueAnomalyDeg: 0,
    },
    color: '#568c87',
    id: 'orbit-1',
  });

  assert.equal(record.id, 'orbit-1');
  assert.equal(record.name, 'LEO-01');
  assert.equal(record.color, '#568c87');
  assert.equal(record.visible, true);
  assert.equal(record.orbit.elements.semiMajorAxisKm, 7000);
  assert.equal(record.metrics.periodSeconds, record.orbit.periodSeconds);
  assert.equal(record.metrics.initialPositionKm.x, 7000);
  assert.equal(record.metrics.initialPositionKm.y, 0);
  assert.ok(record.metrics.speedRangeKmS.min > 7);
});

test('throws structured validation errors for invalid elements', () => {
  assert.throws(
    () => createOrbitRecord({
      elements: {
        semiMajorAxisKm: 6378,
        eccentricity: 0.01,
        inclinationDeg: 0,
        raanDeg: 0,
        argPeriapsisDeg: 0,
        trueAnomalyDeg: 0,
      },
      color: '#568c87',
    }),
    (error) => error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
  );
});
```

- [ ] **Step 2: Extend router tests for `/api/orbit`**

Add this test to `test/api-router.test.mjs`:

```js
test('POST /api/orbit returns computed orbit data', async () => {
  const res = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/orbit',
    body: JSON.stringify({
      id: 'orbit-1',
      color: '#568c87',
      elements: {
        name: 'LEO-01',
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 0,
        raanDeg: 0,
        argPeriapsisDeg: 0,
        trueAnomalyDeg: 0,
      },
    }),
  }), res);

  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, 'orbit-1');
  assert.equal(payload.data.metrics.initialPositionKm.x, 7000);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `node --test test\backend-orbit-service.test.mjs test\api-router.test.mjs`

Expected: FAIL with `Cannot find module` for `backend/orbit-service.mjs` or `NOT_IMPLEMENTED` for `/api/orbit`.

- [ ] **Step 4: Implement the orbit service**

Create `backend/orbit-service.mjs`:

```js
import { computeOrbit, propagateOrbit } from '../js/orbit.mjs';
import { normalizeHexColor } from '../js/color.mjs';
import { ApiRequestError } from './http-utils.mjs';

function orbitId(input = {}) {
  if (typeof input.id === 'string' && input.id.trim()) return input.id.trim();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `orbit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function orbitName(elements, fallbackIndex = 1) {
  const name = elements?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : `Orbit ${fallbackIndex}`;
}

export function createOrbitRecord(input = {}, options = {}) {
  try {
    const orbit = computeOrbit(input.elements ?? input);
    const initial = propagateOrbit(orbit, 0, { perturbationModel: 'two-body' });
    return {
      id: orbitId(input),
      name: orbitName(orbit.elements, options.index ?? 1),
      color: normalizeHexColor(input.color, '#568c87'),
      visible: input.visible ?? true,
      orbit,
      metrics: {
        periodSeconds: orbit.periodSeconds,
        periapsisAltitudeKm: orbit.periapsisAltitudeKm,
        apoapsisAltitudeKm: orbit.apoapsisAltitudeKm,
        speedRangeKmS: orbit.speedRangeKmS,
        initialPositionKm: initial.positionKm,
        initialVelocityKmS: initial.velocityKmS,
      },
    };
  } catch (error) {
    throw new ApiRequestError(400, 'VALIDATION_ERROR', error.message, {
      errors: error.errors ?? [error.message],
    });
  }
}
```

- [ ] **Step 5: Wire `/api/orbit` in the router**

Add this import to `backend/api-router.mjs`:

```js
import { createOrbitRecord } from './orbit-service.mjs';
```

Inside `handleApiRequest`, replace the known-route `NOT_IMPLEMENTED` block with:

```js
    if (path === '/api/orbit') {
      const body = await readJsonBody(request);
      sendOk(response, createOrbitRecord(body));
      return true;
    }
    if (POST_ROUTES.has(path)) {
      await readJsonBody(request);
      sendError(response, 501, 'NOT_IMPLEMENTED', `API route is not implemented yet: ${path}`, { path });
      return true;
    }
```

Update the import line for HTTP utilities:

```js
import {
  ApiRequestError,
  readJsonBody,
  sendCaughtError,
  sendError,
  sendOk,
} from './http-utils.mjs';
```

- [ ] **Step 6: Run orbit service and router tests**

Run: `node --test test\backend-orbit-service.test.mjs test\api-router.test.mjs test\orbit.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/orbit-service.mjs backend/api-router.mjs test/backend-orbit-service.test.mjs test/api-router.test.mjs
git commit -m "feat: compute orbit records on backend"
```

## Task 4: Backend 3D Scene Render Data Service

**Files:**
- Create: `backend/render-data-service.mjs`
- Modify: `backend/api-router.mjs`
- Test: `test/backend-render-data-service.test.mjs`
- Test: `test/api-router.test.mjs`

- [ ] **Step 1: Write failing render-data service tests**

Create `test/backend-render-data-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/orbit-service.mjs';
import {
  buildSceneRenderData,
  earthRotationAngleAt,
  frameAxesRotationAngleAt,
  interpolatePlaybackSample,
  orbitReferenceSampleCount,
} from '../backend/render-data-service.mjs';

function orbitRecord() {
  return createOrbitRecord({
    id: 'orbit-1',
    color: '#568c87',
    elements: {
      name: 'Render Orbit',
      semiMajorAxisKm: 7000,
      eccentricity: 0,
      inclinationDeg: 0,
      raanDeg: 0,
      argPeriapsisDeg: 0,
      trueAnomalyDeg: 0,
    },
  });
}

test('builds scene render data from orbit records', () => {
  const data = buildSceneRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 120,
    perturbationModel: 'j2',
    frame: 'ECEF',
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.equal(data.version, 1);
  assert.equal(data.perturbationModel, 'j2');
  assert.equal(data.frame, 'ECEF');
  assert.equal(data.orbits.length, 1);
  assert.equal(data.orbits[0].id, 'orbit-1');
  assert.ok(data.orbits[0].referencePoints.length >= 180);
  assert.ok(data.orbits[0].referencePoints.length <= 900);
  assert.ok(data.orbits[0].playbackSamples.length >= 180);
  assert.equal(data.orbits[0].current.elapsedSeconds, 120);
  assert.equal(typeof data.earthRotationAngleRad, 'number');
  assert.equal(typeof data.frameAxesRotationAngleRad, 'number');
});

test('interpolates playback samples without orbit math in the caller', () => {
  const sample = interpolatePlaybackSample([
    { elapsedSeconds: 0, positionKm: { x: 0, y: 0, z: 0 }, velocityKmS: { x: 1, y: 0, z: 0 } },
    { elapsedSeconds: 10, positionKm: { x: 10, y: 20, z: 30 }, velocityKmS: { x: 3, y: 4, z: 5 } },
  ], 5);

  assert.deepEqual(sample.positionKm, { x: 5, y: 10, z: 15 });
  assert.deepEqual(sample.velocityKmS, { x: 2, y: 2, z: 2.5 });
  assert.equal(sample.elapsedSeconds, 5);
});

test('computes Earth and frame rotation on the backend render service', () => {
  const siderealHalfDay = 86164.0905 / 2;

  assert.equal(earthRotationAngleAt(0), 0);
  assert.ok(Math.abs(earthRotationAngleAt(siderealHalfDay) - Math.PI) < 1e-12);
  assert.equal(frameAxesRotationAngleAt('ECI', siderealHalfDay), 0);
  assert.ok(Math.abs(frameAxesRotationAngleAt('ECEF', siderealHalfDay) - Math.PI) < 1e-12);
});

test('uses more reference samples for larger orbits in backend render data', () => {
  const small = orbitRecord().orbit;
  const large = createOrbitRecord({
    id: 'large',
    color: '#568c87',
    elements: {
      name: 'Large',
      semiMajorAxisKm: 60000,
      eccentricity: 0.1,
      inclinationDeg: 0,
      raanDeg: 0,
      argPeriapsisDeg: 0,
      trueAnomalyDeg: 0,
    },
  }).orbit;

  assert.ok(orbitReferenceSampleCount(large, 2400) > orbitReferenceSampleCount(small, 2400));
  assert.ok(orbitReferenceSampleCount(small, 2400) >= 180);
  assert.ok(orbitReferenceSampleCount(large, 2400) <= 2400);
});
```

- [ ] **Step 2: Add router test for `/api/scene-render-data`**

Add this test to `test/api-router.test.mjs`:

```js
test('POST /api/scene-render-data returns 3D render payload', async () => {
  const orbitRes = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/orbit',
    body: JSON.stringify({
      id: 'orbit-1',
      color: '#568c87',
      elements: {
        name: 'LEO-01',
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 0,
        raanDeg: 0,
        argPeriapsisDeg: 0,
        trueAnomalyDeg: 0,
      },
    }),
  }), orbitRes);
  const orbit = JSON.parse(orbitRes.body).data;

  const sceneRes = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/scene-render-data',
    body: JSON.stringify({
      orbits: [orbit],
      elapsedSeconds: 60,
      perturbationModel: 'two-body',
      frame: 'ECI',
      performance: { mode: 'power-save', memoryGb: 4 },
    }),
  }), sceneRes);

  const payload = JSON.parse(sceneRes.body);
  assert.equal(sceneRes.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.orbits[0].id, 'orbit-1');
  assert.ok(payload.data.orbits[0].referencePoints.length > 0);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `node --test test\backend-render-data-service.test.mjs test\api-router.test.mjs`

Expected: FAIL with `Cannot find module` for `backend/render-data-service.mjs` or `NOT_IMPLEMENTED` for `/api/scene-render-data`.

- [ ] **Step 4: Implement the render-data service**

Create `backend/render-data-service.mjs`:

```js
import {
  API_VERSION,
  normalizeFrame,
  normalizePerformanceOptions,
  normalizePerturbationModelValue,
} from '../shared/contracts.mjs';
import {
  EARTH_RADIUS_KM,
  normalizePerturbationModel,
  propagateOrbit,
  sampleOrbit,
  vectorMagnitude,
} from '../js/orbit.mjs';
import { groundTrackBudget } from '../js/groundtrack.mjs';

const EARTH_SIDEREAL_DAY_SECONDS = 86164.0905;
const REFERENCE_POINT_SPACING_SCENE = 0.028;
const MIN_REFERENCE_SAMPLES = 180;
const DEFAULT_PLAYBACK_SAMPLES = 720;
const DEFAULT_TAIL_POINTS = 130;

function sceneDistanceKm(orbit) {
  return Math.max(
    orbit.apoapsisRadiusKm ?? orbit.elements.semiMajorAxisKm,
    EARTH_RADIUS_KM,
  );
}

export function earthRotationAngleAt(elapsedSeconds) {
  const rotations = (Number(elapsedSeconds) || 0) / EARTH_SIDEREAL_DAY_SECONDS;
  return (rotations % 1) * Math.PI * 2;
}

export function frameAxesRotationAngleAt(frame, elapsedSeconds) {
  return frame === 'ECEF' ? earthRotationAngleAt(elapsedSeconds) : 0;
}

export function orbitReferenceSampleCount(orbit, maxSamples) {
  const circumferenceScene = (2 * Math.PI * sceneDistanceKm(orbit)) / EARTH_RADIUS_KM;
  const visualCount = Math.ceil(circumferenceScene / REFERENCE_POINT_SPACING_SCENE);
  return Math.max(MIN_REFERENCE_SAMPLES, Math.min(maxSamples, visualCount));
}

function vectorLerp(a, b, fraction) {
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    z: a.z + (b.z - a.z) * fraction,
  };
}

export function interpolatePlaybackSample(samples, elapsedSeconds) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (samples.length === 1) return samples[0];

  const periodSeconds = samples[samples.length - 1].elapsedSeconds || 1;
  const wrappedSeconds = ((Number(elapsedSeconds) % periodSeconds) + periodSeconds) % periodSeconds;
  let upperIndex = samples.findIndex((sample) => sample.elapsedSeconds >= wrappedSeconds);
  if (upperIndex <= 0) upperIndex = 1;
  const previous = samples[upperIndex - 1];
  const next = samples[upperIndex] ?? samples[samples.length - 1];
  const span = next.elapsedSeconds - previous.elapsedSeconds;
  const fraction = span > 0 ? (wrappedSeconds - previous.elapsedSeconds) / span : 0;

  return {
    ...next,
    elapsedSeconds,
    positionKm: vectorLerp(previous.positionKm, next.positionKm, fraction),
    velocityKmS: previous.velocityKmS && next.velocityKmS
      ? vectorLerp(previous.velocityKmS, next.velocityKmS, fraction)
      : next.velocityKmS,
    radiusKm: vectorMagnitude(vectorLerp(previous.positionKm, next.positionKm, fraction)),
  };
}

function serializableState(state) {
  return {
    elapsedSeconds: state.elapsedSeconds,
    positionKm: state.positionKm,
    velocityKmS: state.velocityKmS,
    radiusKm: state.radiusKm,
    perturbationModel: state.perturbationModel,
  };
}

function samplePlayback(orbit, perturbationModel, count = DEFAULT_PLAYBACK_SAMPLES) {
  const safeCount = Math.max(24, Math.floor(count));
  return Array.from({ length: safeCount + 1 }, (_, index) => {
    const elapsedSeconds = (index / safeCount) * orbit.periodSeconds;
    return serializableState(propagateOrbit(orbit, elapsedSeconds, { perturbationModel }));
  });
}

function sampleTailFromPlayback(playbackSamples, elapsedSeconds, periodSeconds) {
  const tailSpan = Math.min(periodSeconds * 0.22, Math.max(420, periodSeconds * 0.1));
  return Array.from({ length: DEFAULT_TAIL_POINTS }, (_, index) => {
    const t = elapsedSeconds - tailSpan * (1 - index / (DEFAULT_TAIL_POINTS - 1));
    const sample = interpolatePlaybackSample(playbackSamples, t);
    return {
      ...sample,
      alpha: 0.03 + (index / (DEFAULT_TAIL_POINTS - 1)) ** 1.35 * 0.84,
      phase: index / (DEFAULT_TAIL_POINTS - 1),
    };
  });
}

function renderOrbit(record, options) {
  const budget = groundTrackBudget(options.performance);
  const orbit = record.orbit;
  const referenceCount = orbitReferenceSampleCount(orbit, budget.max3dReferenceSamples);
  const playbackCount = Math.min(
    budget.maxGroundTrackSamples,
    Math.max(DEFAULT_PLAYBACK_SAMPLES, referenceCount),
  );
  const referencePoints = sampleOrbit(orbit, referenceCount, {
    perturbationModel: options.perturbationModel,
  }).map(serializableState);
  const playbackSamples = samplePlayback(orbit, options.perturbationModel, playbackCount);
  const current = serializableState(propagateOrbit(orbit, options.elapsedSeconds, {
    perturbationModel: options.perturbationModel,
  }));

  return {
    id: record.id,
    name: record.name,
    color: record.color,
    visible: record.visible,
    referencePoints,
    playbackSamples,
    tailSamples: sampleTailFromPlayback(playbackSamples, options.elapsedSeconds, orbit.periodSeconds),
    current,
  };
}

export function buildSceneRenderData(input = {}) {
  const perturbationModel = normalizePerturbationModel(normalizePerturbationModelValue(input.perturbationModel));
  const frame = normalizeFrame(input.frame);
  const elapsedSeconds = Number(input.elapsedSeconds) || 0;
  const performance = normalizePerformanceOptions(input.performance);
  const orbits = Array.isArray(input.orbits) ? input.orbits : [];

  return {
    version: API_VERSION,
    signature: JSON.stringify({
      ids: orbits.map((orbit) => orbit.id),
      elapsedSeconds,
      perturbationModel,
      frame,
      performance,
    }),
    elapsedSeconds,
    perturbationModel,
    frame,
    earthRotationAngleRad: earthRotationAngleAt(elapsedSeconds),
    frameAxesRotationAngleRad: frameAxesRotationAngleAt(frame, elapsedSeconds),
    orbits: orbits.map((record) => renderOrbit(record, {
      elapsedSeconds,
      perturbationModel,
      performance,
    })),
  };
}
```

- [ ] **Step 5: Wire `/api/scene-render-data` in the router**

Add this import:

```js
import { buildSceneRenderData } from './render-data-service.mjs';
```

Add this branch after `/api/orbit`:

```js
    if (path === '/api/scene-render-data') {
      const body = await readJsonBody(request);
      sendOk(response, buildSceneRenderData(body));
      return true;
    }
```

- [ ] **Step 6: Run render-data tests**

Run: `node --test test\backend-render-data-service.test.mjs test\api-router.test.mjs test\arcball.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/render-data-service.mjs backend/api-router.mjs test/backend-render-data-service.test.mjs test/api-router.test.mjs
git commit -m "feat: generate scene render data on backend"
```

## Task 5: Backend Ground-Track Render Data, Stats, and CSV

**Files:**
- Create: `backend/groundtrack-service.mjs`
- Modify: `backend/api-router.mjs`
- Test: `test/backend-groundtrack-service.test.mjs`
- Test: `test/api-router.test.mjs`

- [ ] **Step 1: Write failing ground-track service tests**

Create `test/backend-groundtrack-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/orbit-service.mjs';
import {
  buildGroundTrackCsv,
  buildGroundTrackRegionStats,
  buildGroundTrackRenderData,
} from '../backend/groundtrack-service.mjs';

function orbitRecord() {
  return createOrbitRecord({
    id: 'orbit-1',
    color: '#568c87',
    elements: {
      name: 'Ground Track Orbit',
      semiMajorAxisKm: 7000,
      eccentricity: 0,
      inclinationDeg: 0,
      raanDeg: 0,
      argPeriapsisDeg: 0,
      trueAnomalyDeg: 0,
    },
  });
}

test('builds ground-track render data', () => {
  const data = buildGroundTrackRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 12000,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'j2',
    window: { mode: 'revs', pastRevs: 2 },
    performance: { mode: 'power-save', memoryGb: 4 },
    selectedIds: ['orbit-1'],
  });

  assert.equal(data.version, 1);
  assert.equal(data.tracks.length, 1);
  assert.equal(data.tracks[0].id, 'orbit-1');
  assert.equal(data.tracks[0].current.elapsedSeconds, 12000);
  assert.ok(data.tracks[0].segments.length > 0);
  assert.ok(data.tracks[0].points.every((point) => point.perturbationModel === 'j2'));
});

test('builds ground-track region stats from render data', () => {
  const data = buildGroundTrackRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 12000,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'two-body',
    window: { mode: 'time', pastSeconds: 3600 },
    performance: { mode: 'power-save', memoryGb: 4 },
  });
  const stats = buildGroundTrackRegionStats({
    tracks: data.tracks,
    bounds: { westDeg: -180, eastDeg: 180, southDeg: -5, northDeg: 5 },
  });

  assert.equal(stats.totalOrbitCount, 1);
  assert.ok(stats.totalPointCount > 0);
});

test('builds ground-track CSV text', () => {
  const data = buildGroundTrackRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 12000,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'j3',
    window: { mode: 'time', pastSeconds: 120 },
    performance: { mode: 'power-save', memoryGb: 4 },
  });
  const csv = buildGroundTrackCsv({ tracks: data.tracks });

  assert.match(csv, /轨道名称,轨道 ID,仿真秒,UTC 时间,经度,纬度,动力学模型/);
  assert.match(csv, /Ground Track Orbit,orbit-1/);
  assert.match(csv, /j3/);
});
```

- [ ] **Step 2: Add router tests for ground-track endpoints**

Add this test to `test/api-router.test.mjs`:

```js
test('POST ground-track API endpoints return render data, stats, and CSV', async () => {
  const orbitRes = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/orbit',
    body: JSON.stringify({
      id: 'orbit-1',
      color: '#568c87',
      elements: {
        name: 'Ground Track Orbit',
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 0,
        raanDeg: 0,
        argPeriapsisDeg: 0,
        trueAnomalyDeg: 0,
      },
    }),
  }), orbitRes);
  const orbit = JSON.parse(orbitRes.body).data;

  const renderRes = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/ground-track-render-data',
    body: JSON.stringify({
      orbits: [orbit],
      elapsedSeconds: 120,
      startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
      perturbationModel: 'two-body',
      window: { mode: 'time', pastSeconds: 120 },
      performance: { mode: 'power-save', memoryGb: 4 },
    }),
  }), renderRes);
  const tracks = JSON.parse(renderRes.body).data.tracks;
  assert.ok(tracks[0].points.length > 0);

  const statsRes = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/ground-track-region-stats',
    body: JSON.stringify({
      tracks,
      bounds: { westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90 },
    }),
  }), statsRes);
  assert.equal(JSON.parse(statsRes.body).data.totalOrbitCount, 1);

  const csvRes = response();
  await handleApiRequest(request({
    method: 'POST',
    url: '/api/ground-track-csv',
    body: JSON.stringify({ tracks }),
  }), csvRes);
  assert.equal(csvRes.statusCode, 200);
  assert.match(csvRes.headers['Content-Type'], /text\/csv/);
  assert.match(csvRes.body, /Ground Track Orbit/);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `node --test test\backend-groundtrack-service.test.mjs test\api-router.test.mjs`

Expected: FAIL with `Cannot find module` for `backend/groundtrack-service.mjs` or `NOT_IMPLEMENTED` for ground-track endpoints.

- [ ] **Step 4: Implement the ground-track backend service**

Create `backend/groundtrack-service.mjs`:

```js
import {
  API_VERSION,
  normalizeGroundTrackWindow,
  normalizePerformanceOptions,
  normalizePerturbationModelValue,
} from '../shared/contracts.mjs';
import {
  groundTrackBudget,
  groundTrackCsv,
  groundTrackRegionStats,
  sampleGroundTrack,
  utcMsFromInput,
} from '../js/groundtrack.mjs';

function selectedOrbitRecords(orbits, selectedIds = []) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds.filter(Boolean) : []);
  return (Array.isArray(orbits) ? orbits : [])
    .filter((orbit) => orbit.visible !== false)
    .filter((orbit) => selected.size === 0 || selected.has(orbit.id));
}

function maxSamplesForRecords(budget, count) {
  return Math.max(120, Math.floor(budget.maxGroundTrackSamples / Math.max(1, count)));
}

export function buildGroundTrackRenderData(input = {}) {
  const perturbationModel = normalizePerturbationModelValue(input.perturbationModel);
  const elapsedSeconds = Number(input.elapsedSeconds) || 0;
  const startUtcMs = utcMsFromInput(input.startUtcMs ?? input.startUtc, Date.now());
  const window = normalizeGroundTrackWindow(input.window);
  const performance = normalizePerformanceOptions(input.performance);
  const budget = groundTrackBudget(performance);
  const records = selectedOrbitRecords(input.orbits, input.selectedIds).slice(0, budget.mapCacheTracks);
  const maxSamples = maxSamplesForRecords(budget, records.length);
  const tracks = records.map((orbitRecord) => sampleGroundTrack({
    orbitRecord,
    centerElapsedSeconds: elapsedSeconds,
    startUtcMs,
    perturbationModel,
    window,
    maxSamples,
  }));

  return {
    version: API_VERSION,
    signature: JSON.stringify({
      ids: records.map((orbit) => orbit.id),
      elapsedSeconds,
      startUtcMs,
      perturbationModel,
      window,
      performance,
    }),
    elapsedSeconds,
    startUtcMs,
    perturbationModel,
    window,
    tracks,
  };
}

export function buildGroundTrackRegionStats(input = {}) {
  const tracks = Array.isArray(input.tracks)
    ? input.tracks
    : buildGroundTrackRenderData(input).tracks;
  return groundTrackRegionStats(tracks, input.bounds ?? {
    westDeg: -180,
    eastDeg: 180,
    southDeg: -90,
    northDeg: 90,
  });
}

export function buildGroundTrackCsv(input = {}) {
  const tracks = Array.isArray(input.tracks)
    ? input.tracks
    : buildGroundTrackRenderData(input).tracks;
  return groundTrackCsv(tracks);
}
```

- [ ] **Step 5: Wire ground-track endpoints in the router**

Add this import:

```js
import {
  buildGroundTrackCsv,
  buildGroundTrackRegionStats,
  buildGroundTrackRenderData,
} from './groundtrack-service.mjs';
```

Add these branches after `/api/scene-render-data`:

```js
    if (path === '/api/ground-track-render-data') {
      const body = await readJsonBody(request);
      sendOk(response, buildGroundTrackRenderData(body));
      return true;
    }
    if (path === '/api/ground-track-region-stats') {
      const body = await readJsonBody(request);
      sendOk(response, buildGroundTrackRegionStats(body));
      return true;
    }
    if (path === '/api/ground-track-csv') {
      const body = await readJsonBody(request);
      sendText(response, 200, buildGroundTrackCsv(body), 'text/csv; charset=utf-8');
      return true;
    }
```

Update the HTTP utility import to include `sendText`:

```js
import {
  ApiRequestError,
  readJsonBody,
  sendCaughtError,
  sendError,
  sendOk,
  sendText,
} from './http-utils.mjs';
```

- [ ] **Step 6: Run ground-track tests**

Run: `node --test test\backend-groundtrack-service.test.mjs test\api-router.test.mjs test\groundtrack.test.mjs test\groundtrack-history.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/groundtrack-service.mjs backend/api-router.mjs test/backend-groundtrack-service.test.mjs test/api-router.test.mjs
git commit -m "feat: generate ground-track data on backend"
```

## Task 6: Frontend API Client

**Files:**
- Create: `js/api-client.mjs`
- Create: `test/api-client-static.test.mjs`

- [ ] **Step 1: Write failing API client static tests**

Create `test/api-client-static.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('frontend API client exists and exposes endpoint helpers', async () => {
  assert.equal(await fileExists('js/api-client.mjs'), true, 'frontend API client should exist');
  const apiClient = await readFile('js/api-client.mjs', 'utf8');

  assert.match(apiClient, /postJson/, 'API client should post JSON requests');
  assert.match(apiClient, /createBackendClient/, 'API client should expose a backend client factory');
  assert.match(apiClient, /\/api\/orbit/, 'API client should call the orbit endpoint');
  assert.match(apiClient, /\/api\/scene-render-data/, 'API client should call the scene render endpoint');
  assert.match(apiClient, /\/api\/ground-track-render-data/, 'API client should call the ground-track render endpoint');
  assert.match(apiClient, /\/api\/ground-track-region-stats/, 'API client should call the region stats endpoint');
  assert.match(apiClient, /\/api\/ground-track-csv/, 'API client should call the CSV endpoint');
});
```

- [ ] **Step 2: Run API client static tests and verify they fail**

Run: `node --test test\api-client-static.test.mjs`

Expected: FAIL because `js/api-client.mjs` does not exist.

- [ ] **Step 3: Implement the API client**

Create `js/api-client.mjs`:

```js
export class BackendApiError extends Error {
  constructor(message, payload = null) {
    super(message);
    this.name = 'BackendApiError';
    this.payload = payload;
    this.code = payload?.error?.code ?? 'NETWORK_ERROR';
    this.details = payload?.error?.details ?? {};
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv') || contentType.startsWith('text/')) {
    return response.text();
  }
  return response.json();
}

export async function postJson(path, body, { signal } = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const payload = await parseResponse(response);
  if (typeof payload === 'string') {
    if (!response.ok) throw new BackendApiError(payload);
    return payload;
  }
  if (!response.ok || payload?.ok === false) {
    throw new BackendApiError(payload?.error?.message || '后端计算失败，请重试。', payload);
  }
  return payload.data;
}

export function createBackendClient() {
  let activeController = null;

  function nextSignal() {
    if (activeController) activeController.abort();
    activeController = new AbortController();
    return activeController.signal;
  }

  return {
    createOrbit(input) {
      return postJson('/api/orbit', input, { signal: nextSignal() });
    },
    sceneRenderData(input) {
      return postJson('/api/scene-render-data', input, { signal: nextSignal() });
    },
    groundTrackRenderData(input) {
      return postJson('/api/ground-track-render-data', input, { signal: nextSignal() });
    },
    groundTrackRegionStats(input) {
      return postJson('/api/ground-track-region-stats', input, { signal: nextSignal() });
    },
    groundTrackCsv(input) {
      return postJson('/api/ground-track-csv', input, { signal: nextSignal() });
    },
  };
}
```

- [ ] **Step 4: Run API client static tests**

Run: `node --test test\api-client-static.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit API client and tests**

```bash
git add js/api-client.mjs test/api-client-static.test.mjs
git commit -m "feat: add frontend backend API client"
```

## Task 7: Scene Consumes Backend Render Data

**Files:**
- Modify: `js/scene.mjs`
- Test: `test/arcball.test.mjs`
- Test: `test/static-files.test.mjs`

- [ ] **Step 1: Move scene math tests out of the frontend and add render-data helper tests**

In `test/arcball.test.mjs`, replace the `js/scene.mjs` import with:

```js
import {
  arcballQuaternion,
  cameraPanOffset,
  projectPointerToArcball,
  scenePointFromKm,
} from '../js/scene.mjs';
```

Remove this import because reference-density testing moved to `test/backend-render-data-service.test.mjs`:

```js
import { computeOrbit } from '../js/orbit.mjs';
```

Remove these existing tests from `test/arcball.test.mjs`:

```js
test('computes Earth rotation from simulation time using a sidereal day', () => {
  nearlyEqual(earthRotationAngleAt(0), 0, 1e-12, 'zero time angle');
  nearlyEqual(earthRotationAngleAt(EARTH_SIDEREAL_DAY_SECONDS / 2), Math.PI, 1e-12, 'half sidereal day angle');
  nearlyEqual(earthRotationAngleAt(EARTH_SIDEREAL_DAY_SECONDS), 0, 1e-12, 'full sidereal day wraps');
});

test('rotates only ECEF axes with Earth sidereal time', () => {
  const quarterDay = EARTH_SIDEREAL_DAY_SECONDS / 4;

  nearlyEqual(frameAxesRotationAngleAt('ECI', quarterDay), 0, 1e-12, 'ECI axes stay inertial');
  nearlyEqual(frameAxesRotationAngleAt('ECEF', quarterDay), Math.PI / 2, 1e-12, 'ECEF axes rotate with Earth');
});

test('uses more reference samples for larger orbits to keep visual point density stable', () => {
  const smallOrbit = computeOrbit({
    semiMajorAxisKm: 7000,
    eccentricity: 0.001,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });
  const largeOrbit = computeOrbit({
    semiMajorAxisKm: 60000,
    eccentricity: 0.1,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });

  assert.ok(orbitReferenceSampleCount(largeOrbit) > orbitReferenceSampleCount(smallOrbit));
  assert.ok(orbitReferenceSampleCount(smallOrbit) >= 180);
  assert.ok(orbitReferenceSampleCount(largeOrbit) <= 2400);
});
```

Add this test:

```js
test('converts backend ECI km vectors into scene coordinates', () => {
  const point = scenePointFromKm({ x: 6378.137, y: 0, z: 0 });

  nearlyEqual(point.x, 1, 1e-9, 'scene x');
  nearlyEqual(point.y, 0, 1e-9, 'scene y');
  nearlyEqual(point.z, 0, 1e-9, 'scene z');
});
```

Add this test to `test/static-files.test.mjs`:

```js
test('scene consumes backend render data instead of orbit math', async () => {
  const scene = await readFile('js/scene.mjs', 'utf8');

  assert.doesNotMatch(scene, /from '\.\/orbit\.mjs'/, 'scene should not import orbit math');
  assert.match(scene, /applyRenderData/, 'scene should expose a render-data ingestion method');
  assert.match(scene, /scenePointFromKm/, 'scene should convert backend km vectors to scene coordinates');
});
```

In the existing `test('static app wires Earth self-rotation, graticule, and TXT batch import', ...)` block in `test/static-files.test.mjs`, replace these assertions:

```js
  assert.match(scene, /EARTH_SIDEREAL_DAY_SECONDS/, 'scene should define a sidereal Earth rotation period');
  assert.match(scene, /earthRotationAngleAt/, 'scene should expose testable Earth rotation math');
  assert.match(scene, /frameAxesRotationAngleAt/, 'scene should expose testable frame axes rotation math');
  assert.match(scene, /createEarthGraticule/, 'scene should render 3D earth latitude and longitude lines');
  assert.match(scene, /graticuleGroup/, 'scene should expose a graticule group for toggling');
  assert.match(scene, /this\.earthBody\.rotation\.y = earthRotationAngleAt\(elapsedSeconds\)/, 'scene update should rotate Earth by simulation time');
```

with:

```js
  assert.match(scene, /createEarthGraticule/, 'scene should render 3D earth latitude and longitude lines');
  assert.match(scene, /graticuleGroup/, 'scene should expose a graticule group for toggling');
  assert.match(scene, /applyRenderData/, 'scene should consume backend render data');
  assert.match(scene, /this\.earthBody\.rotation\.y = Number\(renderData\.earthRotationAngleRad\) \|\| 0/, 'scene should apply backend Earth rotation angle');
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test test\arcball.test.mjs test\static-files.test.mjs`

Expected: FAIL because `scenePointFromKm` and `applyRenderData` do not exist and `scene.mjs` still imports `orbit.mjs`.

- [ ] **Step 3: Modify `js/scene.mjs` imports and constants**

Replace the first two import lines with:

```js
import * as THREE from '../vendor/three.module.js';
```

Replace the `EARTH_RADIUS_KM`-derived constant block with:

```js
const EARTH_RADIUS_KM = 6378.137;
const EARTH_SCENE_RADIUS = 1;
const KM_TO_SCENE = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM;
const DEFAULT_TRAIL_POINTS = 130;
const ECLIPTIC_OBLIQUITY_DEG = 23.439;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0.2, 2.0, 4.9);
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 1, 0);
```

Remove `TWO_PI`, `earthRotationAngleAt`, `frameAxesRotationAngleAt`, and `orbitReferenceSignature` from `js/scene.mjs` because backend render data now provides these values.

Keep this temporary compatibility export until Task 9 removes the remaining `app.mjs` dependency:

```js
const REFERENCE_POINT_SPACING_SCENE = 0.028;
const MIN_REFERENCE_SAMPLES = 180;
const MAX_REFERENCE_SAMPLES = 2400;

export function orbitReferenceSampleCount(orbit, maxSamples = MAX_REFERENCE_SAMPLES) {
  const distanceKm = Math.max(
    orbit.apoapsisRadiusKm ?? orbit.elements?.semiMajorAxisKm ?? EARTH_RADIUS_KM,
    EARTH_RADIUS_KM,
  );
  const circumferenceScene = (2 * Math.PI * distanceKm) / EARTH_RADIUS_KM;
  const visualCount = Math.ceil(circumferenceScene / REFERENCE_POINT_SPACING_SCENE);
  return Math.max(MIN_REFERENCE_SAMPLES, Math.min(maxSamples, visualCount));
}
```

- [ ] **Step 4: Add exported scene vector helper**

Replace `function vectorToScene(positionKm)` with:

```js
export function scenePointFromKm(positionKm) {
  return new THREE.Vector3(
    positionKm.x * KM_TO_SCENE,
    positionKm.z * KM_TO_SCENE,
    -positionKm.y * KM_TO_SCENE,
  );
}
```

Replace all remaining `vectorToScene(` calls with `scenePointFromKm(`.

- [ ] **Step 5: Replace orbit sync with render-data sync**

Add this helper before `export class OrbitScene`:

```js
function renderSignature(renderOrbit) {
  return [
    renderOrbit.id,
    renderOrbit.referencePoints?.length ?? 0,
    renderOrbit.referencePoints?.[0]?.elapsedSeconds ?? 0,
    renderOrbit.referencePoints?.at?.(-1)?.elapsedSeconds ?? 0,
  ].join(':');
}
```

Inside `OrbitScene`, replace `setPerformanceBudget`, `syncOrbits`, `updateOrbitReference`, `update`, and `updateOrbitGroup` with:

```js
  setPerformanceBudget() {
  }

  syncRenderOrbits(renderOrbits = []) {
    const activeIds = new Set(renderOrbits.map((orbit) => orbit.id));
    for (const [id, group] of this.orbitGroups.entries()) {
      if (!activeIds.has(id)) {
        this.root.remove(group.root);
        disposeObject(group.root);
        this.orbitGroups.delete(id);
      }
    }

    for (const renderOrbit of renderOrbits) {
      if (!this.orbitGroups.has(renderOrbit.id)) {
        this.orbitGroups.set(renderOrbit.id, this.createOrbitGroup(renderOrbit));
      }
      const group = this.orbitGroups.get(renderOrbit.id);
      group.orbitRecord = renderOrbit;
      this.updateOrbitReference(group, renderOrbit);
      group.root.visible = renderOrbit.visible !== false;
      group.reference.visible = renderOrbit.visible !== false && this.showReference;
      this.updateOrbitGroup(group, renderOrbit);
    }
    this.orbitHoverTargets = Array.from(this.orbitGroups.values())
      .flatMap((group) => [group.reference, group.tail, group.marker]);
    this.applyOrbitFocus();
  }

  updateOrbitReference(group, renderOrbit) {
    const signature = renderSignature(renderOrbit);
    if (group.referenceSignature === signature) return;
    const samples = renderOrbit.referencePoints ?? [];
    const positions = new Float32Array(samples.length * 3);
    samples.forEach((sample, index) => {
      const point = scenePointFromKm(sample.positionKm);
      positions.set([point.x, point.y, point.z], index * 3);
    });

    const referenceGeometry = new THREE.BufferGeometry();
    referenceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    group.reference.geometry.dispose();
    group.reference.geometry = referenceGeometry;
    group.referenceSignature = signature;
  }

  applyRenderData(renderData = {}) {
    this.elapsedSeconds = Number(renderData.elapsedSeconds) || 0;
    this.earthBody.rotation.y = Number(renderData.earthRotationAngleRad) || 0;
    this.axesGroup.rotation.y = Number(renderData.frameAxesRotationAngleRad) || 0;
    this.syncRenderOrbits(renderData.orbits ?? []);
    this.controls.update();
    this.render();
  }

  updateOrbitGroup(group, renderOrbit) {
    const samples = renderOrbit.tailSamples ?? [];
    const positions = group.tail.geometry.getAttribute('position');
    const alphas = group.tail.geometry.getAttribute('alpha');
    const phases = group.tail.geometry.getAttribute('phase');
    group.tail.material.uniforms.time.value = this.elapsedSeconds;

    for (let i = 0; i < DEFAULT_TRAIL_POINTS; i += 1) {
      const sample = samples[i] ?? samples[samples.length - 1] ?? renderOrbit.current;
      const point = sample ? scenePointFromKm(sample.positionKm) : new THREE.Vector3();
      positions.setXYZ(i, point.x, point.y, point.z);
      alphas.setX(i, renderOrbit.visible !== false ? sample?.alpha ?? 0 : 0);
      phases.setX(i, sample?.phase ?? 0);
    }
    positions.needsUpdate = true;
    alphas.needsUpdate = true;
    phases.needsUpdate = true;

    if (renderOrbit.current?.positionKm) {
      group.marker.position.copy(scenePointFromKm(renderOrbit.current.positionKm));
    }
  }
```

- [ ] **Step 6: Keep hover callbacks compatible**

In `showOrbitTooltip` usage, `group.orbitRecord` now contains render data and must still include `name`, `color`, and `id`. Keep those fields in `render-data-service.mjs` responses. Do not use `record.orbit` in hover rendering after Task 8.

- [ ] **Step 7: Update export at bottom**

Replace the final export with:

```js
export { KM_TO_SCENE };
```

- [ ] **Step 8: Run scene tests**

Run: `node --test test\arcball.test.mjs test\static-files.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add js/scene.mjs test/arcball.test.mjs
git commit -m "feat: let scene consume backend render data"
```

## Task 8: App Uses Backend for Orbit and Scene Render Data

**Files:**
- Modify: `js/app.mjs`
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Update imports in `js/app.mjs`**

Replace the first import block:

```js
import {
  computeOrbit,
  formatDuration,
  formatNumber,
  propagateOrbit,
} from './orbit.mjs';
import { OrbitScene, orbitReferenceSampleCount } from './scene.mjs';
```

with:

```js
import {
  formatDuration,
  formatNumber,
} from './orbit.mjs';
import { createBackendClient } from './api-client.mjs';
import { OrbitScene, orbitReferenceSampleCount } from './scene.mjs';
```

Keep the existing `groundTrackBudget`, `groundTrackRegionStats`, and `utcMsFromInput` imports for this task because Task 9 migrates the ground-track path. This keeps the app runnable after the scene-data migration commit.

- [ ] **Step 2: Create a backend client and render-data state**

After the `els` object, add:

```js
const backend = createBackendClient();
```

Inside `state`, add:

```js
  sceneRenderData: null,
  sceneRenderPending: false,
  sceneRenderError: '',
```

- [ ] **Step 3: Replace `buildOrbitRecord` with async backend call**

Replace `function buildOrbitRecord(rawElements, options = {})` with:

```js
async function buildOrbitRecord(rawElements, options = {}) {
  return backend.createOrbit({
    id: options.id,
    color: normalizeHexColor(options.color, nextOrbitColor(state.orbits.length)),
    visible: options.visible ?? true,
    elements: {
      ...rawElements,
      name: rawElements.name?.trim() || `Orbit ${state.orbits.length + 1}`,
    },
  });
}
```

- [ ] **Step 4: Add scene render request helper**

Add after `markSceneDirty()`:

```js
function sceneRenderRequestPayload() {
  return {
    orbits: state.orbits,
    elapsedSeconds: state.elapsedSeconds,
    perturbationModel: state.perturbationModel,
    frame: state.frame,
    performance: {
      mode: state.performanceMode,
      memoryGb: state.customMemoryGb,
    },
  };
}

async function refreshSceneRenderData({ force = false } = {}) {
  if (!force && state.sceneRenderPending) return state.sceneRenderData;
  state.sceneRenderPending = true;
  state.sceneRenderError = '';
  try {
    state.sceneRenderData = await backend.sceneRenderData(sceneRenderRequestPayload());
    scene.applyRenderData(state.sceneRenderData);
  } catch (error) {
    if (error.name !== 'AbortError') {
      state.sceneRenderError = error.message || '后端计算失败，请重试。';
      showErrors(state.sceneRenderError);
    }
  } finally {
    state.sceneRenderPending = false;
  }
  return state.sceneRenderData;
}
```

- [ ] **Step 5: Update form submit event to await backend orbit creation**

In `bindEvents`, replace the `els.form.addEventListener('submit', ...)` callback body with:

```js
    event.preventDefault();
    clearErrors();
    try {
      const rawElements = formToElements();
      const color = getFormColor();
      if (state.editingId) {
        const index = state.orbits.findIndex((orbit) => orbit.id === state.editingId);
        if (index >= 0) {
          state.orbits[index] = await buildOrbitRecord(rawElements, {
            id: state.editingId,
            color,
            visible: state.orbits[index].visible,
          });
        }
      } else {
        state.orbits.push(await buildOrbitRecord(rawElements, { color }));
      }
      setSelectedOrbitIds(state.selectedIds, { currentId: state.editingId, defaultFirst: true });
      state.editingId = null;
      els.submitButton.textContent = '生成轨迹';
      clearGroundTrackHistories();
      markSceneDirty();
      await refreshSceneRenderData({ force: true });
      renderUi();
      saveState();
      resetForm();
    } catch (error) {
      showErrors(error.message || error);
    }
```

- [ ] **Step 6: Update JSON/TXT imports to build records asynchronously**

Replace `buildOrbitRecordsFromSerialized(orbits = [])` with:

```js
async function buildOrbitRecordsFromSerialized(orbits = []) {
  const records = [];
  for (const item of orbits) {
    const raw = item.elements ?? item.orbit?.elements ?? item;
    records.push(await buildOrbitRecord(raw, {
      id: item.id,
      color: item.color,
      visible: item.visible,
    }));
  }
  return records;
}
```

Change `applyWorkbenchSnapshot(snapshot = {})` to `async function applyWorkbenchSnapshot(snapshot = {})`, and replace the orbit assignment block with:

```js
    if (Array.isArray(snapshot?.orbits)) {
      state.orbits = await buildOrbitRecordsFromSerialized(snapshot.orbits);
      setSelectedOrbitIds(
        Array.isArray(snapshot.selectedIds) ? snapshot.selectedIds : snapshot.selectedId ? [snapshot.selectedId] : [],
        { currentId: snapshot.selectedId, defaultFirst: true },
      );
      await refreshSceneRenderData({ force: true });
    }
```

Update every call site of `applyWorkbenchSnapshot(...)` to `await applyWorkbenchSnapshot(...)` inside async callbacks.

- [ ] **Step 7: Make metrics use backend current data**

Replace `renderMetrics()` with:

```js
function renderMetrics() {
  const record = selectedOrbitRecord();
  if (!record) {
    els.selectedOrbitName.textContent = '未选择';
    els.metrics.innerHTML = `
      <div><dt>周期</dt><dd>--</dd></div>
      <div><dt>近地点高度</dt><dd class="metrics-value"><span>--</span><span class="metrics-unit">km</span></dd></div>
      <div><dt>远地点高度</dt><dd class="metrics-value"><span>--</span><span class="metrics-unit">km</span></dd></div>
      <div><dt>速度范围</dt><dd>--</dd></div>
      <div><dt>ECI 位置</dt><dd>--</dd></div>
      <div><dt>ECI 速度</dt><dd>--</dd></div>
    `;
    return;
  }

  const renderOrbit = state.sceneRenderData?.orbits?.find((orbit) => orbit.id === record.id);
  const current = renderOrbit?.current ?? record.metrics;
  els.selectedOrbitName.textContent = record.name;
  els.metrics.innerHTML = [
    metricRow('周期', formatDuration(record.metrics.periodSeconds)),
    metricRow('近地点高度', formatNumber(record.metrics.periapsisAltitudeKm, 2), 'km'),
    metricRow('远地点高度', formatNumber(record.metrics.apoapsisAltitudeKm, 2), 'km'),
    metricRow('速度范围', `${formatNumber(record.metrics.speedRangeKmS.min, 3)} - ${formatNumber(record.metrics.speedRangeKmS.max, 3)} km/s`),
    metricRow('ECI 位置', formatVectorTuple(current.positionKm)),
    metricRow('ECI 速度', formatVectorTuple(current.velocityKmS)),
  ].join('');
}
```

- [ ] **Step 8: Update `tick` scene path**

Replace this line:

```js
  scene.update(state.orbits, state.elapsedSeconds, state.perturbationModel);
```

with:

```js
  if (state.sceneRenderData) {
    scene.applyRenderData({
      ...state.sceneRenderData,
      elapsedSeconds: state.elapsedSeconds,
    });
  }
```

When perturbation model, frame, performance, or orbit visibility changes, call `refreshSceneRenderData({ force: true })` after updating state. Convert those event callbacks to `async` callbacks when needed.

- [ ] **Step 9: Add and run app scene-data boundary tests**

Add this test to `test/static-files.test.mjs`:

```js
test('app loads orbit and scene render data from the backend', async () => {
  const app = await readFile('js/app.mjs', 'utf8');

  assert.match(app, /from '\.\/api-client\.mjs'/, 'app should import the frontend API client');
  assert.match(app, /createBackendClient/, 'app should create a backend client');
  assert.match(app, /backend\.createOrbit/, 'app should create orbit records through the backend');
  assert.match(app, /backend\.sceneRenderData/, 'app should request scene render data through the backend');
  assert.doesNotMatch(app, /computeOrbit/, 'app should not compute orbit records directly');
  assert.doesNotMatch(app, /propagateOrbit/, 'app should not propagate orbits directly');
});
```

Run: `node --test test\static-files.test.mjs test\api-client-static.test.mjs test\importers.test.mjs test\color.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add js/app.mjs test/static-files.test.mjs
git commit -m "feat: load orbit and scene data from backend"
```

## Task 9: App Uses Backend for Ground-Track Data, Stats, and CSV

**Files:**
- Modify: `js/app.mjs`
- Modify: `js/scene.mjs`
- Modify: `index.html` only if a hidden CSV control still exists without a visible trigger
- Test: `test/static-files.test.mjs`

- [ ] **Step 1: Replace ground-track history state**

In `state`, replace:

```js
  groundTrackHistories: new Map(),
  groundTrackTracks: [],
```

with:

```js
  groundTrackTracks: [],
  groundTrackRenderData: null,
  groundTrackRenderPending: false,
  groundTrackRenderError: '',
```

Remove imports from `./groundtrack-history.mjs`.

- [ ] **Step 2: Replace ground-track sync helpers**

Remove `groundTrackReferenceSampleCount`, `rebuildGroundTrackTracksFromCache`, `syncGroundTrackHistories`, and `pruneGroundTrackHistoriesToWindow`.

Remove `orbitReferenceSampleCount` from the `./scene.mjs` import. After this task, `app.mjs` no longer needs the temporary compatibility export added in Task 7.

In `js/scene.mjs`, remove the temporary `REFERENCE_POINT_SPACING_SCENE`, `MIN_REFERENCE_SAMPLES`, `MAX_REFERENCE_SAMPLES`, and `orbitReferenceSampleCount` export added in Task 7.

Add:

```js
function groundTrackRenderRequestPayload() {
  return {
    orbits: activeGroundTrackRecords(),
    elapsedSeconds: state.elapsedSeconds,
    startUtcMs: state.simulationStartUtc,
    perturbationModel: state.perturbationModel,
    window: currentGroundTrackWindow(),
    performance: {
      mode: state.performanceMode,
      memoryGb: state.customMemoryGb,
    },
    selectedIds: Object.entries(state.groundTrackFilters)
      .filter(([, enabled]) => enabled !== false)
      .map(([id]) => id),
  };
}

async function refreshGroundTrackRenderData({ force = false } = {}) {
  if (state.groundTrackPanel === 'closed') {
    state.groundTrackTracks = [];
    state.groundTrackRenderData = null;
    return null;
  }
  if (!force && state.groundTrackRenderPending) return state.groundTrackRenderData;
  state.groundTrackRenderPending = true;
  state.groundTrackRenderError = '';
  try {
    state.groundTrackRenderData = await backend.groundTrackRenderData(groundTrackRenderRequestPayload());
    state.groundTrackTracks = state.groundTrackRenderData.tracks ?? [];
  } catch (error) {
    if (error.name !== 'AbortError') {
      state.groundTrackRenderError = error.message || '后端计算失败，请重试。';
    }
  } finally {
    state.groundTrackRenderPending = false;
  }
  return state.groundTrackRenderData;
}
```

Change `activeGroundTrackRecords(budget)` to:

```js
function activeGroundTrackRecords() {
  syncGroundTrackFilters();
  return state.orbits.filter((orbit) => orbit.visible && state.groundTrackFilters[orbit.id] !== false);
}
```

- [ ] **Step 3: Update render and panel code to await backend map data**

In `setGroundTrackPanel`, replace calls to `syncGroundTrackHistories()` and `requestAnimationFrame(() => renderGroundTrack({ force: true }))` with:

```js
    refreshGroundTrackRenderData({ force: true }).then(() => renderGroundTrack({ force: true }));
```

Replace `renderGroundTrack(options = {})` with:

```js
function renderGroundTrack(options = {}) {
  const isOpen = state.activeModule === 'groundTrack' && !['closed', 'minimized'].includes(state.groundTrackPanel);
  groundTrackView.setPanelOpen(isOpen);
  groundTrackView.setFullscreen(state.groundTrackPanel === 'fullscreen');
  if (!isOpen) return;

  const nowMs = performance.now();
  const minIntervalMs = state.isPlaying ? 240 : 800;
  if (options.force || nowMs - state.lastGroundTrackRenderMs >= minIntervalMs) {
    state.lastGroundTrackRenderMs = nowMs;
    refreshGroundTrackRenderData({ force: Boolean(options.force) }).then(() => {
      groundTrackView.setData(state.groundTrackTracks, {
        selectedIds: state.selectedIds,
        elapsedSeconds: state.elapsedSeconds,
        isPlaying: state.isPlaying,
      });
    });
    return;
  }

  groundTrackView.setData(state.groundTrackTracks, {
    selectedIds: state.selectedIds,
    elapsedSeconds: state.elapsedSeconds,
    isPlaying: state.isPlaying,
  });
}
```

- [ ] **Step 4: Move region stats to backend**

Replace the region callback in `bindEvents` with:

```js
  groundTrackView.setRegionSelectedCallback(async (bounds) => {
    try {
      const stats = await backend.groundTrackRegionStats({
        tracks: state.groundTrackTracks,
        bounds,
      });
      renderGroundTrackStats(stats);
      groundTrackView.setSelectionStats(stats);
    } catch (error) {
      renderGroundTrackStats({
        totalPointCount: 0,
        totalOrbitCount: 0,
        items: [],
        bounds,
        earliestUtcMs: null,
        latestUtcMs: null,
      });
    }
  });
```

- [ ] **Step 5: Move CSV generation to backend**

If there is no visible CSV button, keep this as an API-backed utility for future use. Add:

```js
async function exportGroundTrackCsv() {
  const csv = await backend.groundTrackCsv({
    tracks: state.groundTrackTracks,
  });
  const prefix = (state.exportNamePrefix || 'ground-track').trim() || 'ground-track';
  downloadText(`${prefix}-${currentTimestampLabel()}.csv`, csv, 'text/csv');
}
```

If `els.groundTrackCsv` exists in DOM, bind it:

```js
  if (els.groundTrackCsv) {
    els.groundTrackCsv.addEventListener('click', () => exportGroundTrackCsv().catch((error) => showErrors(error.message || error)));
  }
```

- [ ] **Step 6: Update tick**

Remove this line:

```js
  syncGroundTrackHistories();
```

Keep:

```js
  if (state.groundTrackPanel !== 'closed') renderGroundTrack();
```

- [ ] **Step 7: Run frontend responsibility tests**

Add this test to `test/static-files.test.mjs`:

```js
test('app loads ground-track render data and stats from the backend', async () => {
  const app = await readFile('js/app.mjs', 'utf8');

  assert.match(app, /backend\.groundTrackRenderData/, 'app should request ground-track render data through the backend');
  assert.match(app, /backend\.groundTrackRegionStats/, 'app should request region stats through the backend');
  assert.match(app, /backend\.groundTrackCsv/, 'app should request CSV through the backend');
  assert.doesNotMatch(app, /from '\.\/groundtrack-history\.mjs'/, 'app should not import ground-track history calculation');
  assert.doesNotMatch(app, /groundTrackRegionStats,/, 'app should not import direct region stats calculation');
});
```

Run: `node --test test\static-files.test.mjs`

Expected: PASS for frontend responsibility boundary: `app.mjs` imports API client and no longer directly imports `computeOrbit`, `propagateOrbit`, `sampleOrbit`, or `groundTrackRegionStats`; `scene.mjs` no longer imports `./orbit.mjs`.

- [ ] **Step 8: Commit**

```bash
git add js/app.mjs js/scene.mjs index.html test/static-files.test.mjs
git commit -m "feat: load ground-track data from backend"
```

## Task 10: API Server Integration Tests

**Files:**
- Create: `test/server-api.test.mjs`
- Modify: `server.mjs` only if the test needs exportable server factory

- [ ] **Step 1: Refactor `server.mjs` for testable startup**

Replace the bottom `server.listen(...)` block with:

```js
export function startServer({ port: listenPort = port, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    server.listen(listenPort, host, () => {
      console.log(`ECI orbit workbench running at http://${host}:${listenPort}`);
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  startServer();
}
```

If Windows path comparison fails in smoke tests, replace the condition with:

```js
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  startServer();
}
```

- [ ] **Step 2: Write server integration tests**

Create `test/server-api.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server.mjs';

async function withServer(fn) {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('serves static index and orbit API from the same local server', async () => {
  await withServer(async (baseUrl) => {
    const index = await fetch(`${baseUrl}/index.html`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /轨道模拟工作台/);

    const orbit = await fetch(`${baseUrl}/api/orbit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    const payload = await orbit.json();
    assert.equal(orbit.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.id, 'orbit-1');
  });
});

test('serves structured API errors', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missing`);
    const payload = await response.json();
    assert.equal(response.status, 404);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'NOT_FOUND');
  });
});
```

- [ ] **Step 3: Run server API test**

Run: `node --test test\server-api.test.mjs`

Expected: PASS.

- [ ] **Step 4: Run full automated suite**

Run: `node --test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.mjs test/server-api.test.mjs
git commit -m "test: cover local API server integration"
```

## Task 11: Browser Verification and README Update

**Files:**
- Modify: `README.md`
- Generated: `artifacts/backend-split-smoke.png`

- [ ] **Step 1: Update README backend description**

Add this section to `README.md` after the startup section:

```markdown
## 架构

本项目使用本地 Node.js 服务同时提供静态网页和 `/api/*` 后端接口。前端负责页面交互、Three.js/Canvas 显示和本地播放控制；后端负责轨道计算、摄动传播、3D 渲染数据生成、星下点轨迹数据、区域统计和 CSV 数据生成。
```

- [ ] **Step 2: Start the local server**

Run: `node server.mjs`

Expected: terminal prints `ECI orbit workbench running at http://127.0.0.1:4173`.

- [ ] **Step 3: Use a browser smoke check**

Open `http://127.0.0.1:4173`, add a 7000 km circular orbit, verify:

- Metrics populate.
- 3D marker and reference orbit render.
- Play/pause updates the marker.
- Switching J2 refreshes the scene without console errors.
- Opening the ground-track panel renders map tracks.
- Screenshot export still downloads PNG.

Save a screenshot to `artifacts/backend-split-smoke.png`.

- [ ] **Step 4: Stop the server**

Stop the `node server.mjs` process with Ctrl+C after browser verification.

- [ ] **Step 5: Run final checks**

Run: `node --test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md artifacts/backend-split-smoke.png
git commit -m "docs: describe backend render data split"
```

## Self-Review Checklist

- Spec coverage: Tasks 1-5 implement backend contracts, APIs, orbit computation, 3D render data, ground-track data, stats, and CSV. Tasks 6-9 enforce frontend display-only responsibility. Task 10 proves static and API server coexist. Task 11 covers startup and browser verification.
- Placeholder scan: The plan uses explicit file paths, concrete commands, expected outputs, test code, and implementation code for new modules and modified functions.
- Type consistency: API names are consistent across `shared/contracts.mjs`, `backend/api-router.mjs`, `js/api-client.mjs`, tests, and frontend call sites: `createOrbit`, `sceneRenderData`, `groundTrackRenderData`, `groundTrackRegionStats`, and `groundTrackCsv`.
