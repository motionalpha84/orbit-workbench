# Frontend Backend Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the orbit workbench into a static frontend service on port `4173` and a Fastify backend API service on port `26563`, with the frontend consuming backend-generated render data.

**Architecture:** Keep the existing native HTML/CSS/ESM frontend and static `server.mjs`. Add a separate Fastify backend under `backend/`, expose JSON and CSV APIs, and add `js/api-client.mjs` as the browser's only backend access layer. Move orbit propagation, scene sample generation, ground-track path generation, region stats, and CSV generation behind backend services while Three.js and Canvas remain in the browser.

**Tech Stack:** Node.js ES modules, Fastify, `@fastify/cors`, `concurrently`, Node built-in test runner, vanilla browser ES modules, Three.js, Canvas 2D.

---

## File Structure

- Create `package.json`: project scripts and dependencies.
- Modify `server.mjs`: keep it as the frontend static service and export `startFrontendServer()` for tests.
- Modify `start-workbench.bat`: start both frontend and backend through npm scripts and open `http://127.0.0.1:4173`.
- Create `backend/errors.mjs`: structured API error class and response helpers.
- Create `backend/app.mjs`: Fastify app factory, CORS, health route, route registration, error handler.
- Create `backend/server.mjs`: backend process entrypoint, default `API_PORT=26563`.
- Create `backend/services/orbit-service.mjs`: create validated orbit records and metrics.
- Create `backend/services/render-data-service.mjs`: create 3D render payloads.
- Create `backend/services/groundtrack-service.mjs`: create ground-track render payloads, region stats, and CSV.
- Create `backend/routes/orbits.mjs`, `backend/routes/render-data.mjs`, `backend/routes/groundtrack.mjs`: Fastify route modules.
- Create `js/api-client.mjs`: frontend backend client.
- Modify `js/scene.mjs`: receive backend render data instead of computing orbit propagation.
- Modify `js/app.mjs`: use `js/api-client.mjs` for orbit creation, scene render data, ground-track data, stats, and CSV.
- Modify `README.md`: document dual-process startup and ports.
- Modify `test/static-files.test.mjs`: update responsibility-boundary tests.
- Create `test/backend-app.test.mjs`, `test/backend-orbit-service.test.mjs`, `test/backend-render-data-service.test.mjs`, `test/backend-groundtrack-service.test.mjs`, `test/api-client-static.test.mjs`, `test/server-startup.test.mjs`.

## Task 1: Package Scripts and Frontend Server Entrypoint

**Files:**
- Create: `package.json`
- Modify: `server.mjs`
- Modify: `start-workbench.bat`
- Modify: `README.md`
- Test: `test/server-startup.test.mjs`
- Test: `test/static-files.test.mjs`

- [ ] **Step 1: Write failing startup tests**

Create `test/server-startup.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { startFrontendServer } from '../server.mjs';

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('frontend server can start on an ephemeral port and serve index.html', async () => {
  const server = await startFrontendServer({ port: 0, host: '127.0.0.1', log: false });
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/index.html`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /轨道模拟工作台/);
  } finally {
    await closeServer(server);
  }
});

test('package scripts expose frontend, backend, dev, and test commands', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.frontend, 'node server.mjs');
  assert.equal(pkg.scripts.backend, 'node backend/server.mjs');
  assert.match(pkg.scripts.dev, /concurrently/);
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.dependencies.fastify.length > 0, true);
  assert.equal(pkg.dependencies['@fastify/cors'].length > 0, true);
  assert.equal(pkg.devDependencies.concurrently.length > 0, true);
});

test('Windows launcher starts the dual-process workbench', async () => {
  const script = await readFile('start-workbench.bat', 'utf8');
  const readme = await readFile('README.md', 'utf8');

  assert.match(script, /API_PORT=26563/);
  assert.match(script, /npm run dev/);
  assert.match(script, /http:\/\/127\.0\.0\.1:4173/);
  assert.match(readme, /26563/);
  assert.match(readme, /npm run dev/);
});
```

- [ ] **Step 2: Run startup tests and verify they fail**

Run: `node --test test\server-startup.test.mjs`

Expected: FAIL because `package.json` does not exist and `server.mjs` does not export `startFrontendServer`.

- [ ] **Step 3: Add package scripts**

Create `package.json`:

```json
{
  "name": "orbit-workbench",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "frontend": "node server.mjs",
    "backend": "node backend/server.mjs",
    "dev": "concurrently -k -n frontend,backend -c cyan,green \"npm run frontend\" \"npm run backend\"",
    "test": "node --test"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "fastify": "^5.2.1"
  },
  "devDependencies": {
    "concurrently": "^9.1.2"
  }
}
```

- [ ] **Step 4: Refactor frontend static server for testable startup**

Replace `server.mjs` with:

```js
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const defaultPort = Number(process.env.PORT || 4173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function safePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  const requested = decodedPath === '/' ? '/index.html' : decodedPath;
  const absolute = normalize(join(root, requested));
  if (!absolute.startsWith(root)) return null;
  return absolute;
}

export function createFrontendServer() {
  return createServer((request, response) => {
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
}

export function startFrontendServer({ port = defaultPort, host = '127.0.0.1', log = true } = {}) {
  const server = createFrontendServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      if (log) console.log(`ECI orbit workbench frontend running at http://${host}:${server.address().port}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  startFrontendServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: Update Windows launcher**

Replace `start-workbench.bat` with:

```bat
@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not defined PORT set "PORT=4173"
if not defined API_PORT set "API_PORT=26563"
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  echo Install Node.js, or run this project from the Codex desktop environment.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing npm dependencies...
  npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo ECI Orbit Workbench
echo Frontend: %URL%
echo Backend:  http://%HOST%:%API_PORT%
echo Press Ctrl+C to stop both services.
echo.

if not "%OPEN_BROWSER%"=="0" (
  start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Milliseconds 1200; Start-Process '%URL%'"
)

npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Workbench stopped with exit code %EXIT_CODE%.
) else (
  echo Workbench stopped.
)
pause
exit /b %EXIT_CODE%
```

- [ ] **Step 6: Update README startup and architecture text**

Replace the README startup section with:

```markdown
## 启动

双击 `start-workbench.bat` 启动前端静态服务和后端 API 服务，并打开网页。默认地址：

- 前端页面：`http://127.0.0.1:4173`
- 后端 API：`http://127.0.0.1:26563`

如需手动启动，可在项目目录执行：

```powershell
npm install
npm run dev
```

也可以分别启动：

```powershell
npm run frontend
npm run backend
```

如需修改端口，可设置 `PORT` 或 `API_PORT` 后再运行启动脚本。

## 架构

本项目使用两个本地进程：前端静态服务负责页面资源和浏览器交互，Fastify 后端 API 服务负责轨道计算、摄动传播、3D 可绘制数据、星下点路径、区域统计和 CSV 数据生成。Three.js 和 Canvas 仍在浏览器中负责实际绘制。
```

Keep the existing `## 功能` section after this new architecture section.

- [ ] **Step 7: Run startup and static tests**

Run: `node --test test\server-startup.test.mjs test\static-files.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json server.mjs start-workbench.bat README.md test/server-startup.test.mjs test/static-files.test.mjs
git commit -m "chore: add dual-process startup"
```

## Task 2: Fastify Backend Skeleton

**Files:**
- Create: `backend/errors.mjs`
- Create: `backend/app.mjs`
- Create: `backend/server.mjs`
- Test: `test/backend-app.test.mjs`

- [ ] **Step 1: Write failing backend app tests**

Create `test/backend-app.test.mjs`:

```js
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
```

- [ ] **Step 2: Run backend app tests and verify they fail**

Run: `node --test test\backend-app.test.mjs`

Expected: FAIL because `backend/app.mjs` does not exist.

- [ ] **Step 3: Add backend error helpers**

Create `backend/errors.mjs`:

```js
import { apiError, apiOk } from '../shared/contracts.mjs';

export class ApiRequestError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function ok(data) {
  return apiOk(data);
}

export function fail(code, message, details = {}) {
  return apiError(code, message, details);
}

export function notFound(path) {
  return new ApiRequestError(404, 'NOT_FOUND', `API route not found: ${path}`, { path });
}

export function methodNotAllowed(path, method) {
  return new ApiRequestError(405, 'METHOD_NOT_ALLOWED', `${path} requires POST.`, { path, method });
}
```

- [ ] **Step 4: Add Fastify app skeleton**

Create `backend/app.mjs`:

```js
import cors from '@fastify/cors';
import Fastify from 'fastify';

import { API_VERSION } from '../shared/contracts.mjs';
import { ApiRequestError, fail, methodNotAllowed, notFound } from './errors.mjs';

const POST_ONLY_PATHS = new Set([
  '/api/orbit',
  '/api/scene-render-data',
  '/api/ground-track-render-data',
  '/api/ground-track-region-stats',
  '/api/ground-track-csv',
]);

export function createBackendApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 8 * 1024 * 1024,
  });

  app.register(cors, {
    origin: true,
  });

  app.get('/', async () => ({
    ok: true,
    service: 'orbit-api',
    version: API_VERSION,
  }));

  for (const path of POST_ONLY_PATHS) {
    app.get(path, async (request) => {
      throw methodNotAllowed(path, request.method);
    });
  }

  app.setNotFoundHandler((request) => {
    throw notFound(new URL(request.url, 'http://127.0.0.1').pathname);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiRequestError) {
      reply.status(error.statusCode).send(fail(error.code, error.message, error.details));
      return;
    }
    if (error.validation) {
      reply.status(400).send(fail('VALIDATION_ERROR', 'Request validation failed.', { validation: error.validation }));
      return;
    }
    reply.status(500).send(fail('INTERNAL_ERROR', error?.message || 'Internal server error.'));
  });

  return app;
}
```

- [ ] **Step 5: Add backend process entrypoint**

Create `backend/server.mjs`:

```js
import { createBackendApp } from './app.mjs';

const port = Number(process.env.API_PORT || 26563);
const host = process.env.API_HOST || '127.0.0.1';

const app = createBackendApp({ logger: true });

try {
  await app.listen({ port, host });
  console.log(`Orbit API running at http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
```

- [ ] **Step 6: Run backend app tests**

Run: `node --test test\backend-app.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/errors.mjs backend/app.mjs backend/server.mjs test/backend-app.test.mjs
git commit -m "feat: add Fastify backend skeleton"
```

## Task 3: Backend Orbit Service and Route

**Files:**
- Create: `backend/services/orbit-service.mjs`
- Create: `backend/routes/orbits.mjs`
- Modify: `backend/app.mjs`
- Test: `test/backend-orbit-service.test.mjs`
- Test: `test/backend-app.test.mjs`

- [ ] **Step 1: Write failing orbit service and route tests**

Create `test/backend-orbit-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/services/orbit-service.mjs';

const elements = {
  name: 'LEO-01',
  semiMajorAxisKm: 7000,
  eccentricity: 0,
  inclinationDeg: 0,
  raanDeg: 0,
  argPeriapsisDeg: 0,
  trueAnomalyDeg: 0,
};

test('creates an orbit record with metrics and initial state', () => {
  const record = createOrbitRecord({ id: 'orbit-1', color: '#568c87', elements });

  assert.equal(record.id, 'orbit-1');
  assert.equal(record.name, 'LEO-01');
  assert.equal(record.color, '#568c87');
  assert.equal(record.visible, true);
  assert.equal(record.orbit.elements.semiMajorAxisKm, 7000);
  assert.equal(record.metrics.periodSeconds, record.orbit.periodSeconds);
  assert.equal(record.metrics.initialPositionKm.x, 7000);
  assert.ok(record.metrics.speedRangeKmS.min > 7);
});

test('throws structured validation errors for invalid elements', () => {
  assert.throws(
    () => createOrbitRecord({
      elements: { ...elements, semiMajorAxisKm: 6378, eccentricity: 0.01 },
      color: '#568c87',
    }),
    (error) => error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
  );
});
```

Append this test to `test/backend-app.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test test\backend-orbit-service.test.mjs test\backend-app.test.mjs`

Expected: FAIL because `backend/services/orbit-service.mjs` does not exist or `/api/orbit` returns 404.

- [ ] **Step 3: Implement orbit service**

Create `backend/services/orbit-service.mjs`:

```js
import { normalizeHexColor } from '../../js/color.mjs';
import { computeOrbit, propagateOrbit } from '../../js/orbit.mjs';
import { ApiRequestError } from '../errors.mjs';

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

- [ ] **Step 4: Add orbit route and register it**

Create `backend/routes/orbits.mjs`:

```js
import { ok } from '../errors.mjs';
import { createOrbitRecord } from '../services/orbit-service.mjs';

export async function registerOrbitRoutes(app) {
  app.post('/api/orbit', async (request) => ok(createOrbitRecord(request.body ?? {})));
}
```

Modify `backend/app.mjs` by importing and registering the route before the not-found handler:

```js
import { registerOrbitRoutes } from './routes/orbits.mjs';
```

```js
  app.register(registerOrbitRoutes);
```

- [ ] **Step 5: Run orbit tests**

Run: `node --test test\backend-orbit-service.test.mjs test\backend-app.test.mjs test\orbit.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/orbit-service.mjs backend/routes/orbits.mjs backend/app.mjs test/backend-orbit-service.test.mjs test/backend-app.test.mjs
git commit -m "feat: compute orbit records on backend"
```

## Task 4: Backend Scene Render Data Service

**Files:**
- Create: `backend/services/render-data-service.mjs`
- Create: `backend/routes/render-data.mjs`
- Modify: `backend/app.mjs`
- Test: `test/backend-render-data-service.test.mjs`
- Test: `test/backend-app.test.mjs`

- [ ] **Step 1: Write failing scene render data tests**

Create `test/backend-render-data-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/services/orbit-service.mjs';
import { createSceneRenderData } from '../backend/services/render-data-service.mjs';

function orbitRecord() {
  return createOrbitRecord({
    id: 'orbit-1',
    color: '#568c87',
    elements: {
      name: 'LEO-01',
      semiMajorAxisKm: 7000,
      eccentricity: 0.001,
      inclinationDeg: 51.6,
      raanDeg: 40,
      argPeriapsisDeg: 30,
      trueAnomalyDeg: 0,
    },
  });
}

test('creates 3D render data for visible orbits', () => {
  const data = createSceneRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 120,
    perturbationModel: 'j2',
    frame: 'ECEF',
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.equal(data.version, 1);
  assert.equal(data.elapsedSeconds, 120);
  assert.equal(data.frame, 'ECEF');
  assert.equal(data.perturbationModel, 'j2');
  assert.equal(data.orbits.length, 1);
  assert.equal(data.orbits[0].id, 'orbit-1');
  assert.ok(data.orbits[0].referencePoints.length >= 180);
  assert.ok(data.orbits[0].playbackSamples.length >= 180);
  assert.equal(data.orbits[0].tailSamples.length, 130);
  assert.equal(typeof data.orbits[0].current.positionKm.x, 'number');
});

test('performance mode bounds scene sample counts', () => {
  const data = createSceneRenderData({
    orbits: [orbitRecord()],
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.ok(data.orbits[0].referencePoints.length <= 900);
  assert.ok(data.orbits[0].playbackSamples.length <= 900);
});
```

Append this test to `test/backend-app.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test test\backend-render-data-service.test.mjs test\backend-app.test.mjs`

Expected: FAIL because render data service and route do not exist.

- [ ] **Step 3: Implement scene render data service**

Create `backend/services/render-data-service.mjs`:

```js
import { API_VERSION, normalizeFrame, normalizePerformanceOptions, normalizePerturbationModelValue } from '../../shared/contracts.mjs';
import { groundTrackBudget } from '../../js/groundtrack.mjs';
import { EARTH_RADIUS_KM, propagateOrbit, sampleOrbit } from '../../js/orbit.mjs';

const EARTH_SCENE_RADIUS = 1;
const KM_TO_SCENE = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM;
const DEFAULT_TRAIL_POINTS = 130;
const REFERENCE_POINT_SPACING_SCENE = 0.028;
const MIN_REFERENCE_SAMPLES = 180;
const MAX_REFERENCE_SAMPLES = 2400;
const EARTH_SIDEREAL_DAY_SECONDS = 86164.0905;
const TWO_PI = Math.PI * 2;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vectorToScenePoint(positionKm) {
  return {
    x: positionKm.x * KM_TO_SCENE,
    y: positionKm.z * KM_TO_SCENE,
    z: -positionKm.y * KM_TO_SCENE,
  };
}

export function earthRotationAngleAt(elapsedSeconds) {
  const angle = (finiteNumber(elapsedSeconds) / EARTH_SIDEREAL_DAY_SECONDS) * TWO_PI;
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

export function frameAxesRotationAngleAt(frame, elapsedSeconds) {
  return frame === 'ECEF' ? earthRotationAngleAt(elapsedSeconds) : 0;
}

export function orbitReferenceSampleCount(orbit, maxSamples = MAX_REFERENCE_SAMPLES) {
  const a = orbit.elements.semiMajorAxisKm * KM_TO_SCENE;
  const b = a * Math.sqrt(1 - orbit.elements.eccentricity ** 2);
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const maximumSamples = Math.max(MIN_REFERENCE_SAMPLES, Math.floor(Number(maxSamples) || MAX_REFERENCE_SAMPLES));
  return Math.min(maximumSamples, Math.max(MIN_REFERENCE_SAMPLES, Math.round(perimeter / REFERENCE_POINT_SPACING_SCENE)));
}

function renderSample(sample) {
  return {
    elapsedSeconds: sample.elapsedSeconds,
    positionKm: sample.positionKm,
    velocityKmS: sample.velocityKmS,
    scenePoint: vectorToScenePoint(sample.positionKm),
  };
}

function tailSamplesForOrbit(orbit, elapsedSeconds, perturbationModel) {
  const period = orbit.periodSeconds;
  const tailSpan = Math.min(period * 0.22, Math.max(420, period * 0.1));
  return Array.from({ length: DEFAULT_TRAIL_POINTS }, (_, index) => {
    const fade = index / (DEFAULT_TRAIL_POINTS - 1);
    const t = finiteNumber(elapsedSeconds) - tailSpan * (1 - fade);
    const sample = propagateOrbit(orbit, t, { perturbationModel });
    return {
      ...renderSample(sample),
      alpha: 0.03 + fade ** 1.35 * 0.84,
      phase: fade,
    };
  });
}

export function createSceneRenderData(input = {}) {
  const elapsedSeconds = finiteNumber(input.elapsedSeconds);
  const perturbationModel = normalizePerturbationModelValue(input.perturbationModel);
  const frame = normalizeFrame(input.frame);
  const performance = normalizePerformanceOptions(input.performance);
  const budget = groundTrackBudget(performance);
  const maxReferenceSamples = Math.min(MAX_REFERENCE_SAMPLES, budget.max3dReferenceSamples);
  const visibleOrbits = (Array.isArray(input.orbits) ? input.orbits : []).filter((orbit) => orbit.visible !== false);

  return {
    version: API_VERSION,
    elapsedSeconds,
    perturbationModel,
    frame,
    performance,
    earthRotationAngleRad: earthRotationAngleAt(elapsedSeconds),
    frameAxesRotationAngleRad: frameAxesRotationAngleAt(frame, elapsedSeconds),
    orbits: visibleOrbits.map((orbitRecord) => {
      const referenceCount = orbitReferenceSampleCount(orbitRecord.orbit, maxReferenceSamples);
      const referencePoints = sampleOrbit(orbitRecord.orbit, referenceCount, { perturbationModel }).map(renderSample);
      const playbackSamples = sampleOrbit(orbitRecord.orbit, referenceCount, { perturbationModel }).map(renderSample);
      const current = renderSample(propagateOrbit(orbitRecord.orbit, elapsedSeconds, { perturbationModel }));
      return {
        id: orbitRecord.id,
        name: orbitRecord.name,
        color: orbitRecord.color,
        visible: orbitRecord.visible !== false,
        referencePoints,
        playbackSamples,
        tailSamples: tailSamplesForOrbit(orbitRecord.orbit, elapsedSeconds, perturbationModel),
        current,
      };
    }),
  };
}
```

- [ ] **Step 4: Add scene render route and register it**

Create `backend/routes/render-data.mjs`:

```js
import { ok } from '../errors.mjs';
import { createSceneRenderData } from '../services/render-data-service.mjs';

export async function registerRenderDataRoutes(app) {
  app.post('/api/scene-render-data', async (request) => ok(createSceneRenderData(request.body ?? {})));
}
```

Modify `backend/app.mjs`:

```js
import { registerRenderDataRoutes } from './routes/render-data.mjs';
```

```js
  app.register(registerRenderDataRoutes);
```

- [ ] **Step 5: Run scene render tests**

Run: `node --test test\backend-render-data-service.test.mjs test\backend-app.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/render-data-service.mjs backend/routes/render-data.mjs backend/app.mjs test/backend-render-data-service.test.mjs test/backend-app.test.mjs
git commit -m "feat: generate scene render data on backend"
```

## Task 5: Backend Ground-Track Service and Routes

**Files:**
- Create: `backend/services/groundtrack-service.mjs`
- Create: `backend/routes/groundtrack.mjs`
- Modify: `backend/app.mjs`
- Test: `test/backend-groundtrack-service.test.mjs`
- Test: `test/backend-app.test.mjs`

- [ ] **Step 1: Write failing ground-track service and route tests**

Create `test/backend-groundtrack-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/services/orbit-service.mjs';
import {
  createGroundTrackCsv,
  createGroundTrackRegionStats,
  createGroundTrackRenderData,
} from '../backend/services/groundtrack-service.mjs';

function orbitRecord() {
  return createOrbitRecord({
    id: 'orbit-1',
    color: '#568c87',
    elements: {
      name: 'LEO-01',
      semiMajorAxisKm: 7000,
      eccentricity: 0.001,
      inclinationDeg: 51.6,
      raanDeg: 40,
      argPeriapsisDeg: 30,
      trueAnomalyDeg: 0,
    },
  });
}

test('creates ground-track render data', () => {
  const data = createGroundTrackRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 600,
    startUtcMs: Date.UTC(2026, 0, 1),
    perturbationModel: 'j3',
    window: { mode: 'revs', pastRevs: 1 },
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.equal(data.version, 1);
  assert.equal(data.tracks.length, 1);
  assert.equal(data.tracks[0].id, 'orbit-1');
  assert.ok(data.tracks[0].points.length > 0);
  assert.ok(data.tracks[0].segments.length > 0);
  assert.equal(data.tracks[0].current.perturbationModel, 'j3');
});

test('creates region stats and CSV from tracks', () => {
  const data = createGroundTrackRenderData({ orbits: [orbitRecord()] });
  const stats = createGroundTrackRegionStats({
    tracks: data.tracks,
    bounds: { westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90 },
  });
  const csv = createGroundTrackCsv({ tracks: data.tracks });

  assert.equal(stats.totalOrbitCount, 1);
  assert.match(csv, /轨道名称,轨道 ID,仿真秒,UTC 时间,经度,纬度,动力学模型/);
  assert.match(csv, /LEO-01/);
});
```

Append this test to `test/backend-app.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test test\backend-groundtrack-service.test.mjs test\backend-app.test.mjs`

Expected: FAIL because ground-track backend service and route do not exist.

- [ ] **Step 3: Implement ground-track service**

Create `backend/services/groundtrack-service.mjs`:

```js
import { API_VERSION, normalizeGroundTrackWindow, normalizePerformanceOptions, normalizePerturbationModelValue } from '../../shared/contracts.mjs';
import {
  groundTrackBudget,
  groundTrackCsv,
  groundTrackRegionStats,
  sampleGroundTrack,
  utcMsFromInput,
} from '../../js/groundtrack.mjs';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function selectedOrbitIds(input = {}) {
  return Array.isArray(input.selectedIds) ? new Set(input.selectedIds) : null;
}

export function createGroundTrackRenderData(input = {}) {
  const elapsedSeconds = finiteNumber(input.elapsedSeconds);
  const startUtcMs = utcMsFromInput(input.startUtcMs ?? input.startUtc, Date.now());
  const perturbationModel = normalizePerturbationModelValue(input.perturbationModel);
  const performance = normalizePerformanceOptions(input.performance);
  const window = normalizeGroundTrackWindow(input.window);
  const budget = groundTrackBudget(performance);
  const selectedIds = selectedOrbitIds(input);
  const activeOrbits = (Array.isArray(input.orbits) ? input.orbits : [])
    .filter((orbit) => orbit.visible !== false)
    .filter((orbit) => !selectedIds || selectedIds.has(orbit.id));
  const perOrbitMaxSamples = Math.max(120, Math.floor(budget.maxGroundTrackSamples / Math.max(1, activeOrbits.length)));

  return {
    version: API_VERSION,
    elapsedSeconds,
    startUtcMs,
    perturbationModel,
    window,
    performance,
    tracks: activeOrbits.map((orbitRecord) => sampleGroundTrack({
      orbitRecord,
      centerElapsedSeconds: elapsedSeconds,
      startUtcMs,
      perturbationModel,
      window,
      maxSamples: perOrbitMaxSamples,
    })),
  };
}

export function createGroundTrackRegionStats(input = {}) {
  return groundTrackRegionStats(input.tracks ?? [], input.bounds ?? {
    westDeg: -180,
    eastDeg: 180,
    southDeg: -90,
    northDeg: 90,
  });
}

export function createGroundTrackCsv(input = {}) {
  const tracks = Array.isArray(input.tracks)
    ? input.tracks
    : createGroundTrackRenderData(input).tracks;
  return groundTrackCsv(tracks);
}
```

- [ ] **Step 4: Add ground-track routes and register them**

Create `backend/routes/groundtrack.mjs`:

```js
import { ok } from '../errors.mjs';
import {
  createGroundTrackCsv,
  createGroundTrackRegionStats,
  createGroundTrackRenderData,
} from '../services/groundtrack-service.mjs';

export async function registerGroundTrackRoutes(app) {
  app.post('/api/ground-track-render-data', async (request) => ok(createGroundTrackRenderData(request.body ?? {})));
  app.post('/api/ground-track-region-stats', async (request) => ok(createGroundTrackRegionStats(request.body ?? {})));
  app.post('/api/ground-track-csv', async (request, reply) => {
    reply.type('text/csv; charset=utf-8').send(createGroundTrackCsv(request.body ?? {}));
  });
}
```

Modify `backend/app.mjs`:

```js
import { registerGroundTrackRoutes } from './routes/groundtrack.mjs';
```

```js
  app.register(registerGroundTrackRoutes);
```

- [ ] **Step 5: Run ground-track tests**

Run: `node --test test\backend-groundtrack-service.test.mjs test\backend-app.test.mjs test\groundtrack.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/groundtrack-service.mjs backend/routes/groundtrack.mjs backend/app.mjs test/backend-groundtrack-service.test.mjs test/backend-app.test.mjs
git commit -m "feat: generate ground-track data on backend"
```

## Task 6: Frontend API Client

**Files:**
- Create: `js/api-client.mjs`
- Test: `test/api-client-static.test.mjs`

- [ ] **Step 1: Write failing API client static tests**

Create `test/api-client-static.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend API client defaults to backend port 26563 and exposes required methods', async () => {
  const client = await readFile('js/api-client.mjs', 'utf8');

  assert.match(client, /127\.0\.0\.1:26563/);
  assert.match(client, /window\.__ORBIT_API_BASE_URL__/);
  for (const method of [
    'createOrbit',
    'sceneRenderData',
    'groundTrackRenderData',
    'groundTrackRegionStats',
    'groundTrackCsv',
  ]) {
    assert.match(client, new RegExp(`${method}\\(`), `client should expose ${method}`);
  }
  assert.match(client, /AbortController/);
  assert.match(client, /response\.json/);
  assert.match(client, /response\.text/);
});
```

- [ ] **Step 2: Run API client test and verify it fails**

Run: `node --test test\api-client-static.test.mjs`

Expected: FAIL because `js/api-client.mjs` does not exist.

- [ ] **Step 3: Implement frontend API client**

Create `js/api-client.mjs`:

```js
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:26563';

function configuredBaseUrl() {
  const runtimeValue = globalThis.window?.__ORBIT_API_BASE_URL__;
  return typeof runtimeValue === 'string' && runtimeValue.trim()
    ? runtimeValue.trim().replace(/\/$/, '')
    : DEFAULT_API_BASE_URL;
}

export class BackendApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, details = {} } = {}) {
    super(message);
    this.name = 'BackendApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createBackendClient({ baseUrl = configuredBaseUrl(), fetchImpl = fetch } = {}) {
  const controllers = new Map();

  async function requestJson(key, path, body) {
    controllers.get(key)?.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      const error = payload.error ?? {};
      throw new BackendApiError(error.message || `API request failed: ${path}`, {
        code: error.code,
        status: response.status,
        details: error.details,
      });
    }
    return payload.data;
  }

  async function requestText(key, path, body) {
    controllers.get(key)?.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BackendApiError(text || `API request failed: ${path}`, {
        status: response.status,
      });
    }
    return text;
  }

  return {
    baseUrl,
    createOrbit(payload) {
      return requestJson('orbit', '/api/orbit', payload);
    },
    sceneRenderData(payload) {
      return requestJson('scene-render-data', '/api/scene-render-data', payload);
    },
    groundTrackRenderData(payload) {
      return requestJson('ground-track-render-data', '/api/ground-track-render-data', payload);
    },
    groundTrackRegionStats(payload) {
      return requestJson('ground-track-region-stats', '/api/ground-track-region-stats', payload);
    },
    groundTrackCsv(payload) {
      return requestText('ground-track-csv', '/api/ground-track-csv', payload);
    },
  };
}
```

- [ ] **Step 4: Run API client test**

Run: `node --test test\api-client-static.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/api-client.mjs test/api-client-static.test.mjs
git commit -m "feat: add frontend backend API client"
```

## Task 7: Scene Consumes Backend Render Data

**Files:**
- Modify: `js/scene.mjs`
- Test: `test/static-files.test.mjs`
- Test: `test/arcball.test.mjs`

- [ ] **Step 1: Write failing scene responsibility tests**

Append these assertions to the static app test that reads `js/scene.mjs`:

```js
test('scene consumes backend render data instead of propagating orbits', async () => {
  const scene = await readFile('js/scene.mjs', 'utf8');

  assert.match(scene, /applyRenderData/, 'scene should expose a render-data ingestion method');
  assert.match(scene, /applyOrbitRenderData/, 'scene should update individual orbit groups from backend data');
  assert.doesNotMatch(scene, /from '\.\/orbit\.mjs'/, 'scene should not import orbit propagation');
  assert.doesNotMatch(scene, /propagateOrbit/, 'scene should not propagate orbit state');
  assert.doesNotMatch(scene, /sampleOrbit/, 'scene should not sample orbit references');
});
```

- [ ] **Step 2: Run scene responsibility tests and verify they fail**

Run: `node --test test\static-files.test.mjs test\arcball.test.mjs`

Expected: FAIL because `scene.mjs` still imports and calls orbit propagation.

- [ ] **Step 3: Move scene constants and helpers out of orbit dependency**

In `js/scene.mjs`, replace the orbit import with:

```js
import * as THREE from '../vendor/three.module.js';
```

Add local constants:

```js
const EARTH_RADIUS_KM = 6378.137;
const SUPPORTED_PERTURBATION_MODELS = new Set(['two-body', 'j2', 'j3']);
```

Add:

```js
function normalizePerturbationModel(model) {
  return SUPPORTED_PERTURBATION_MODELS.has(model) ? model : 'two-body';
}
```

Keep `KM_TO_SCENE`, `vectorToScene`, `earthRotationAngleAt`, `frameAxesRotationAngleAt`, and `orbitReferenceSampleCount` exports so existing tests keep passing.

- [ ] **Step 4: Replace reference generation with backend points**

Replace `updateOrbitReference(group, orbitRecord, perturbationModel)` with:

```js
  updateOrbitReference(group, referencePoints = []) {
    const positions = new Float32Array(referencePoints.length * 3);
    referencePoints.forEach((sample, index) => {
      const point = sample.scenePoint
        ? new THREE.Vector3(sample.scenePoint.x, sample.scenePoint.y, sample.scenePoint.z)
        : vectorToScene(sample.positionKm);
      positions.set([point.x, point.y, point.z], index * 3);
    });

    const referenceGeometry = new THREE.BufferGeometry();
    referenceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    group.reference.geometry.dispose();
    group.reference.geometry = referenceGeometry;
  }
```

Update `createOrbitGroup` so it does not call `this.updateOrbitReference(...)` during creation. The returned group should remain:

```js
const group = { root, reference, tail, marker, orbitRecord, referenceSignature: '' };
return group;
```

- [ ] **Step 5: Add render-data ingestion methods**

Add these methods to `OrbitScene`:

```js
  applyRenderData(renderData = {}) {
    this.elapsedSeconds = Number(renderData.elapsedSeconds) || 0;
    this.perturbationModel = normalizePerturbationModel(renderData.perturbationModel);
    this.earthBody.rotation.y = Number(renderData.earthRotationAngleRad) || 0;
    this.axesGroup.rotation.y = Number(renderData.frameAxesRotationAngleRad) || 0;
    const renderOrbits = Array.isArray(renderData.orbits) ? renderData.orbits : [];
    const shellRecords = renderOrbits.map((orbit) => ({
      id: orbit.id,
      name: orbit.name,
      color: orbit.color,
      visible: orbit.visible !== false,
      orbit: { elements: {}, periodSeconds: 1 },
    }));
    this.syncOrbits(shellRecords, this.perturbationModel);
    for (const orbitRenderData of renderOrbits) {
      const group = this.orbitGroups.get(orbitRenderData.id);
      if (!group || orbitRenderData.visible === false) continue;
      this.applyOrbitRenderData(group, orbitRenderData);
    }
    this.controls.update();
    this.render();
  }

  applyOrbitRenderData(group, orbitRenderData) {
    this.updateOrbitReference(group, orbitRenderData.referencePoints ?? []);
    const tailSamples = orbitRenderData.tailSamples ?? [];
    const positions = group.tail.geometry.getAttribute('position');
    const alphas = group.tail.geometry.getAttribute('alpha');
    const phases = group.tail.geometry.getAttribute('phase');
    group.tail.material.uniforms.time.value = this.elapsedSeconds;

    for (let i = 0; i < DEFAULT_TRAIL_POINTS; i += 1) {
      const sample = tailSamples[Math.min(i, Math.max(0, tailSamples.length - 1))];
      const scenePoint = sample?.scenePoint ?? { x: 0, y: 0, z: 0 };
      positions.setXYZ(i, scenePoint.x, scenePoint.y, scenePoint.z);
      alphas.setX(i, orbitRenderData.visible === false ? 0 : Number(sample?.alpha ?? 0));
      phases.setX(i, Number(sample?.phase ?? 0));
    }
    positions.needsUpdate = true;
    alphas.needsUpdate = true;
    phases.needsUpdate = true;

    const currentPoint = orbitRenderData.current?.scenePoint;
    if (currentPoint) group.marker.position.set(currentPoint.x, currentPoint.y, currentPoint.z);
  }
```

Remove `update(orbits, elapsedSeconds, perturbationModel)` and `updateOrbitGroup(...)` once all frontend call sites use `applyRenderData`.

- [ ] **Step 6: Run scene tests**

Run: `node --test test\static-files.test.mjs test\arcball.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add js/scene.mjs test/static-files.test.mjs
git commit -m "feat: render scene from backend data"
```

## Task 8: App Uses Backend for Orbit and Scene Data

**Files:**
- Modify: `js/app.mjs`
- Modify: `test/static-files.test.mjs`
- Test: `test/importers.test.mjs`
- Test: `test/color.test.mjs`

- [ ] **Step 1: Write failing app scene-data boundary tests**

Append this test to `test/static-files.test.mjs`:

```js
test('app loads orbit and scene render data from the backend', async () => {
  const app = await readFile('js/app.mjs', 'utf8');

  assert.match(app, /from '\.\/api-client\.mjs'/, 'app should import the frontend API client');
  assert.match(app, /createBackendClient/, 'app should create a backend client');
  assert.match(app, /backend\.createOrbit/, 'app should create orbit records through the backend');
  assert.match(app, /backend\.sceneRenderData/, 'app should request scene render data through the backend');
  assert.match(app, /scene\.applyRenderData/, 'app should pass backend render data to the scene');
  assert.doesNotMatch(app, /computeOrbit/, 'app should not compute orbit records directly');
  assert.doesNotMatch(app, /propagateOrbit/, 'app should not propagate orbits directly');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test test\static-files.test.mjs test\api-client-static.test.mjs`

Expected: FAIL because `app.mjs` still computes orbit records and calls `scene.update`.

- [ ] **Step 3: Update app imports and backend state**

Replace the top orbit imports in `js/app.mjs` with:

```js
import {
  formatDuration,
  formatNumber,
} from './orbit.mjs';
import { OrbitScene } from './scene.mjs';
import { createBackendClient } from './api-client.mjs';
```

Create the backend client after `groundTrackView` is created:

```js
const backend = createBackendClient();
```

Add these state fields:

```js
  sceneRenderData: null,
  sceneRenderPending: false,
  sceneRenderError: '',
```

- [ ] **Step 4: Replace orbit record construction**

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

Replace `function buildOrbitRecordsFromSerialized(orbits = [])` with:

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

Convert `applyWorkbenchSnapshot(snapshot = {})`, `restoreState()`, `importJson(file)`, and `importTxt(file)` to async where they call backend orbit creation. Await every call to `buildOrbitRecord`, `buildOrbitRecordsFromSerialized`, and `applyWorkbenchSnapshot`.

- [ ] **Step 5: Add scene render request helper**

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
  if (state.orbits.length === 0) {
    state.sceneRenderData = null;
    scene.applyRenderData({ elapsedSeconds: state.elapsedSeconds, orbits: [] });
    return null;
  }
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

- [ ] **Step 6: Update form submit and controls to refresh scene data**

Convert the form submit callback to `async` and replace its body with:

```js
    event.preventDefault();
    clearErrors();
    try {
      const raw = formToElements();
      const existingIndex = state.orbits.findIndex((orbit) => orbit.id === state.editingId);
      const record = await buildOrbitRecord(raw, {
        id: state.editingId ?? undefined,
        color: getFormColor(),
        visible: existingIndex >= 0 ? state.orbits[existingIndex].visible : true,
      });
      if (existingIndex >= 0) {
        state.orbits.splice(existingIndex, 1, record);
        clearGroundTrackHistories(record.id);
      } else {
        state.orbits.push(record);
      }
      setSelectedOrbitIds([...state.selectedIds.filter((id) => id !== record.id), record.id], { currentId: record.id });
      markSceneDirty();
      await refreshSceneRenderData({ force: true });
      resetForm();
      renderUi();
      saveState();
    } catch (error) {
      showErrors(error.errors ?? error.message);
    }
```

Whenever frame, perturbation model, performance mode, orbit visibility, orbit deletion, clear-all, import, or reset affects render data, call `await refreshSceneRenderData({ force: true })` in that event path. Convert those callbacks to async when they await.

- [ ] **Step 7: Update metrics and tick**

Replace `renderMetrics()` current-state calculation with:

```js
  const renderOrbit = state.sceneRenderData?.orbits?.find((orbit) => orbit.id === record.id);
  const current = renderOrbit?.current ?? record.metrics;
```

Use `current.positionKm` and `current.velocityKmS` in the metric rows.

In `tick(nowMs)`, replace:

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

- [ ] **Step 8: Initialize asynchronously**

Replace the bottom startup block with:

```js
async function init() {
  if (!state.simulationStartUtc) state.simulationStartUtc = utcDatetimeLocalValue(new Date());
  restoreAssetLibrary();
  await restoreState();
  bindEvents();
  setOverlaysFromInputs({ markDirty: false });
  if (DEFAULT_ORBIT_COLORS.length > 0 && !state.editingId) setNextFormColor();
  await refreshSceneRenderData({ force: true });
  renderUi();
  requestAnimationFrame(tick);
}

init().catch((error) => {
  showErrors(error.message || error);
  renderUi();
  requestAnimationFrame(tick);
});
```

- [ ] **Step 9: Run app scene-data tests**

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
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Write failing app ground-track boundary tests**

Append this test to `test/static-files.test.mjs`:

```js
test('app loads ground-track render data and stats from the backend', async () => {
  const app = await readFile('js/app.mjs', 'utf8');

  assert.match(app, /backend\.groundTrackRenderData/, 'app should request ground-track render data through the backend');
  assert.match(app, /backend\.groundTrackRegionStats/, 'app should request region stats through the backend');
  assert.match(app, /backend\.groundTrackCsv/, 'app should request CSV through the backend');
  assert.doesNotMatch(app, /from '\.\/groundtrack-history\.mjs'/, 'app should not import ground-track history calculation');
  assert.doesNotMatch(app, /groundTrackRegionStats,/, 'app should not import direct region stats calculation');
  assert.doesNotMatch(app, /groundTrackBudget/, 'app should not calculate backend sampling budget');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test test\static-files.test.mjs`

Expected: FAIL because `app.mjs` still imports ground-track calculation modules.

- [ ] **Step 3: Replace ground-track calculation state**

Remove these imports from `js/app.mjs`:

```js
import {
  groundTrackBudget,
  groundTrackRegionStats,
  utcMsFromInput,
} from './groundtrack.mjs';
import {
  groundTrackTrackFromHistory,
  pruneGroundTrackHistory,
  updateGroundTrackHistory,
} from './groundtrack-history.mjs';
```

Add a small local UTC parser if `utcMsFromInput` was only needed for app state:

```js
function utcMsFromInput(value, fallbackMs = Date.now()) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return fallbackMs;
  const trimmed = value.trim();
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const utcText = hasTimezone ? trimmed : `${trimmed.length === 16 ? `${trimmed}:00` : trimmed}Z`;
  const parsed = Date.parse(utcText);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}
```

Replace state fields:

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

- [ ] **Step 4: Replace ground-track sync helpers**

Remove `currentGroundTrackBudget`, `groundTrackReferenceSampleCount`, `rebuildGroundTrackTracksFromCache`, `syncGroundTrackHistories`, and `pruneGroundTrackHistoriesToWindow`.

Keep `clearGroundTrackHistories(id = null)` as a compatibility helper, but replace its body with:

```js
function clearGroundTrackHistories() {
  state.groundTrackTracks = [];
  state.groundTrackRenderData = null;
  renderGroundTrackStats();
  groundTrackView.setSelectionStats(null);
}
```

Replace `activeGroundTrackRecords(budget)` with:

```js
function activeGroundTrackRecords() {
  syncGroundTrackFilters();
  return state.orbits.filter((orbit) => orbit.visible && state.groundTrackFilters[orbit.id] !== false);
}
```

Add:

```js
function groundTrackRenderRequestPayload() {
  return {
    orbits: activeGroundTrackRecords(),
    elapsedSeconds: state.elapsedSeconds,
    startUtcMs: utcMsFromInput(state.simulationStartUtc),
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
      showErrors(state.groundTrackRenderError);
    }
  } finally {
    state.groundTrackRenderPending = false;
  }
  return state.groundTrackRenderData;
}
```

- [ ] **Step 5: Update render, stats, and CSV paths**

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

Add:

```js
async function exportGroundTrackCsv() {
  const csv = await backend.groundTrackCsv({ tracks: state.groundTrackTracks });
  const prefix = (state.exportNamePrefix || 'ground-track').trim() || 'ground-track';
  downloadText(`${prefix}-${currentTimestampLabel()}.csv`, csv, 'text/csv');
}
```

Replace the region selected callback with:

```js
  groundTrackView.setRegionSelectedCallback(async (bounds) => {
    try {
      const stats = await backend.groundTrackRegionStats({
        tracks: state.groundTrackTracks,
        bounds,
      });
      renderGroundTrackStats(stats);
      groundTrackView.setSelectionStats(stats);
    } catch {
      const emptyStats = {
        totalPointCount: 0,
        totalOrbitCount: 0,
        items: [],
        bounds,
        earliestUtcMs: null,
        latestUtcMs: null,
      };
      renderGroundTrackStats(emptyStats);
      groundTrackView.setSelectionStats(emptyStats);
    }
  });
```

If `els.groundTrackCsv` exists, bind:

```js
  if (els.groundTrackCsv) {
    els.groundTrackCsv.addEventListener('click', () => exportGroundTrackCsv().catch((error) => showErrors(error.message || error)));
  }
```

- [ ] **Step 6: Remove old sync calls**

Remove or replace all calls to:

```js
syncGroundTrackHistories();
pruneGroundTrackHistoriesToWindow();
rebuildGroundTrackTracksFromCache();
currentGroundTrackBudget();
```

Use `refreshGroundTrackRenderData({ force: true }).then(() => renderGroundTrack({ force: true }))` in panel-open, filter-change, UTC-change, window-change, performance-change, and resize paths when fresh backend data is needed.

In `tick(nowMs)`, remove:

```js
  syncGroundTrackHistories();
```

Keep:

```js
  if (state.groundTrackPanel !== 'closed') renderGroundTrack();
```

- [ ] **Step 7: Run ground-track frontend boundary tests**

Run: `node --test test\static-files.test.mjs test\api-client-static.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/app.mjs js/scene.mjs test/static-files.test.mjs
git commit -m "feat: load ground-track data from backend"
```

## Task 10: Full Integration Tests and Documentation

**Files:**
- Modify: `README.md`
- Test: all tests

- [ ] **Step 1: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and `node_modules` is installed.

- [ ] **Step 2: Run the full automated suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Start both services for smoke verification**

Run: `npm run dev`

Expected:

- frontend logs a URL containing `http://127.0.0.1:4173`
- backend logs a URL containing `http://127.0.0.1:26563`

- [ ] **Step 4: Verify backend health**

Open or fetch `http://127.0.0.1:26563/`.

Expected JSON:

```json
{
  "ok": true,
  "service": "orbit-api",
  "version": 1
}
```

- [ ] **Step 5: Verify browser workflow**

Open `http://127.0.0.1:4173` and verify:

- adding a 7000 km circular orbit populates metrics
- 3D reference orbit, marker, and tail render
- play, pause, reset, and speed changes remain responsive
- switching J2 and J3 refreshes displayed data
- opening the ground-track panel renders tracks
- selecting a map region displays backend stats
- PNG export works
- CSV export works when a CSV trigger exists

- [ ] **Step 6: Commit lockfile and docs**

```bash
git add package-lock.json README.md
git commit -m "docs: document dual-process backend split"
```

## Self-Review Checklist

- Spec coverage: Tasks 1 and 10 cover dual-process startup, ports `4173` and `26563`, npm scripts, launcher, and docs. Tasks 2-5 cover Fastify backend, health check, orbit records, scene render data, ground-track data, stats, and CSV. Task 6 covers configurable frontend API access. Tasks 7-9 move scene and app responsibilities to backend data consumption. Task 10 covers full test and browser verification.
- Placeholder scan: This plan contains exact file paths, concrete commands, expected results, and code snippets for every new module and major replacement block. It does not include unresolved placeholders.
- Type consistency: API method names are consistent across backend routes and `js/api-client.mjs`: `createOrbit`, `sceneRenderData`, `groundTrackRenderData`, `groundTrackRegionStats`, and `groundTrackCsv`. Default backend port is consistently `26563`; frontend port is consistently `4173`.
