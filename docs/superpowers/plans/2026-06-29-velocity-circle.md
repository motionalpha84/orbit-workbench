# Velocity Circle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-sidebar “速度圆” module that opens like the existing ground-track module, renders interactive 3D velocity-vector circles for visible orbits, and exports the current velocity-circle view as PNG from the assets panel.

**Architecture:** Keep velocity-circle sampling in a pure ES module, keep Three.js rendering in a separate view module, and wire app state in `js/app.mjs` without restructuring the existing `OrbitScene`. The panel state mirrors the ground-track panel: `closed | window | fullscreen | minimized`, with pinning, sidebar toggling, and draw throttling.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript ES modules, vendored Three.js, Node built-in test runner, local static server.

---

## File Structure

- Create `js/velocity-circle.mjs`: pure data generation for reference velocity circles, current velocity vectors, short velocity-endpoint trails, finite vector guards, and per-track sampling.
- Create `js/velocity-circle-view.mjs`: isolated Three.js view for axes, reference circles, current arrows, short trails, hover picking, resize, fixed-size PNG capture, and disposal of old render objects.
- Create `test/velocity-circle.test.mjs`: unit tests for velocity-circle sampling and finite data contracts.
- Create `test/velocity-circle-view.test.mjs`: unit tests for view helper functions and no-canvas guards.
- Modify `test/static-files.test.mjs`: static tests for sidebar order, velocity panel DOM, app imports/state/events, and assets export button.
- Modify `index.html`: add velocity-circle panel, sidebar button between `groundTrack` and `assets`, and assets-panel PNG export button.
- Modify `styles.css`: add velocity-circle panel layout and shared visual styling aligned with ground-track panel.
- Modify `js/app.mjs`: instantiate `VelocityCircleView`, manage velocity-circle filters/panel state/rendering/export, and hook it into existing orbit lifecycle events.

## Existing Context

- `js/orbit.mjs` exports `propagateOrbit(orbit, elapsedSeconds, { perturbationModel })`, which returns `velocityKmS`.
- `js/app.mjs` already stores visible orbit records in `state.orbits`, selected ids in `state.selectedIds`, current sim time in `state.elapsedSeconds`, and perturbation model in `state.perturbationModel`.
- `groundTrackPanel` is a special floating module controlled by sidebar nav, not a `side-module-panel`. Match that behavior for `velocityCirclePanel`.
- `groundTrackBudget()` already defines app performance modes. Reuse its output to derive velocity-circle sample counts instead of adding another performance UI.

### Task 1: Pure Velocity-Circle Data

**Files:**
- Create: `js/velocity-circle.mjs`
- Create: `test/velocity-circle.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/velocity-circle.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeOrbit,
  propagateOrbit,
  vectorMagnitude,
} from '../js/orbit.mjs';
import {
  sampleVelocityCircle,
  sampleVelocityCircles,
  velocityMagnitudeKmS,
  velocityTrailSpanSeconds,
} from '../js/velocity-circle.mjs';

const nearlyEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
};

function orbitRecord(overrides = {}) {
  const orbit = computeOrbit({
    name: 'Velocity Test',
    semiMajorAxisKm: 7200,
    eccentricity: 0.08,
    inclinationDeg: 42,
    raanDeg: 18,
    argPeriapsisDeg: 64,
    trueAnomalyDeg: 12,
    ...overrides,
  });
  return {
    id: overrides.id ?? 'velocity-test',
    name: overrides.name ?? 'Velocity Test',
    color: overrides.color ?? '#7fd1c7',
    visible: overrides.visible ?? true,
    orbit,
  };
}

test('computes velocity magnitude from km/s vector components', () => {
  nearlyEqual(velocityMagnitudeKmS({ x: 3, y: 4, z: 12 }), 13, 1e-12, 'speed magnitude');
  assert.equal(velocityMagnitudeKmS({ x: NaN, y: 1, z: 2 }), 0);
});

test('samples a future one-revolution velocity circle from current simulation time', () => {
  const record = orbitRecord();
  const elapsedSeconds = 1200;
  const track = sampleVelocityCircle({
    orbitRecord: record,
    elapsedSeconds,
    perturbationModel: 'two-body',
    sampleCount: 32,
    trailSampleCount: 8,
  });
  const current = propagateOrbit(record.orbit, elapsedSeconds, { perturbationModel: 'two-body' });

  assert.equal(track.id, record.id);
  assert.equal(track.name, record.name);
  assert.equal(track.color, record.color);
  assert.equal(track.samples.length, 33);
  assert.equal(track.trail.length, 8);
  assert.equal(track.perturbationModel, 'two-body');
  nearlyEqual(track.current.velocityKmS.x, current.velocityKmS.x, 1e-10, 'current vx');
  nearlyEqual(track.current.velocityKmS.y, current.velocityKmS.y, 1e-10, 'current vy');
  nearlyEqual(track.current.velocityKmS.z, current.velocityKmS.z, 1e-10, 'current vz');
  nearlyEqual(track.speedKmS, vectorMagnitude(current.velocityKmS), 1e-10, 'current speed');
  assert.equal(track.samples[0].elapsedSeconds, elapsedSeconds);
  nearlyEqual(track.samples.at(-1).elapsedSeconds, elapsedSeconds + record.orbit.periodSeconds, 1e-9, 'future circle endpoint');
  assert.ok(track.samples.every((point) => Number.isFinite(point.velocityKmS.x)));
  assert.ok(track.samples.every((point) => Number.isFinite(point.speedKmS)));
});

test('builds a short trail that ends at the current velocity endpoint', () => {
  const record = orbitRecord();
  const elapsedSeconds = 850;
  const track = sampleVelocityCircle({
    orbitRecord: record,
    elapsedSeconds,
    sampleCount: 24,
    trailSampleCount: 6,
  });

  assert.equal(track.trail.length, 6);
  assert.ok(track.trail[0].elapsedSeconds < elapsedSeconds);
  assert.equal(track.trail.at(-1).elapsedSeconds, elapsedSeconds);
  nearlyEqual(track.trail.at(-1).velocityKmS.x, track.current.velocityKmS.x, 1e-12, 'trail end vx');
  assert.ok(velocityTrailSpanSeconds(record.orbit) > 0);
});

test('passes perturbation models through to every sampled point', () => {
  const record = orbitRecord({ eccentricity: 0.18, inclinationDeg: 63.4 });
  for (const perturbationModel of ['j2', 'j3']) {
    const track = sampleVelocityCircle({
      orbitRecord: record,
      elapsedSeconds: 86400,
      perturbationModel,
      sampleCount: 18,
      trailSampleCount: 4,
    });
    assert.equal(track.current.perturbationModel, perturbationModel);
    assert.ok(track.samples.every((point) => point.perturbationModel === perturbationModel));
    assert.ok(track.trail.every((point) => point.perturbationModel === perturbationModel));
  }
});

test('samples multiple visible records and skips invalid records', () => {
  const first = orbitRecord({ id: 'first', name: 'First' });
  const second = orbitRecord({ id: 'second', name: 'Second', semiMajorAxisKm: 14000, eccentricity: 0.22 });
  const tracks = sampleVelocityCircles([first, null, second, { id: 'bad' }], {
    elapsedSeconds: 400,
    perturbationModel: 'two-body',
    sampleCount: 12,
    trailSampleCount: 3,
  });

  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks.map((track) => track.id), ['first', 'second']);
  assert.ok(tracks.every((track) => track.samples.length === 13));
  assert.ok(tracks.every((track) => track.trail.length === 3));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --test test\velocity-circle.test.mjs
```

Expected: FAIL with an import error because `js/velocity-circle.mjs` does not exist.

- [ ] **Step 3: Implement the pure module**

Create `js/velocity-circle.mjs`:

```js
import {
  normalizePerturbationModel,
  propagateOrbit,
  vectorMagnitude,
} from './orbit.mjs';

const DEFAULT_SAMPLE_COUNT = 180;
const DEFAULT_TRAIL_SAMPLE_COUNT = 24;
const MIN_SAMPLE_COUNT = 12;
const MAX_SAMPLE_COUNT = 720;
const MIN_TRAIL_SAMPLE_COUNT = 2;
const MAX_TRAIL_SAMPLE_COUNT = 96;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteVector(vector = {}) {
  return {
    x: finiteNumber(vector.x),
    y: finiteNumber(vector.y),
    z: finiteNumber(vector.z),
  };
}

export function velocityMagnitudeKmS(vector = {}) {
  const safe = finiteVector(vector);
  return vectorMagnitude(safe);
}

export function velocityTrailSpanSeconds(orbit) {
  const periodSeconds = finiteNumber(orbit?.periodSeconds, 0);
  if (periodSeconds <= 0) return 120;
  return clamp(periodSeconds * 0.06, 90, 1800);
}

function normalizeSampleCount(sampleCount) {
  return clamp(Math.floor(finiteNumber(sampleCount, DEFAULT_SAMPLE_COUNT)), MIN_SAMPLE_COUNT, MAX_SAMPLE_COUNT);
}

function normalizeTrailSampleCount(sampleCount) {
  return clamp(
    Math.floor(finiteNumber(sampleCount, DEFAULT_TRAIL_SAMPLE_COUNT)),
    MIN_TRAIL_SAMPLE_COUNT,
    MAX_TRAIL_SAMPLE_COUNT,
  );
}

function velocityPoint(orbit, elapsedSeconds, perturbationModel) {
  const state = propagateOrbit(orbit, elapsedSeconds, { perturbationModel });
  const velocityKmS = finiteVector(state.velocityKmS);
  return {
    elapsedSeconds,
    velocityKmS,
    speedKmS: velocityMagnitudeKmS(velocityKmS),
    perturbationModel: state.perturbationModel,
  };
}

function hasOrbit(record) {
  return Boolean(record?.orbit && Number.isFinite(Number(record.orbit.periodSeconds)));
}

export function sampleVelocityCircle({
  orbitRecord,
  elapsedSeconds = 0,
  perturbationModel = 'two-body',
  sampleCount = DEFAULT_SAMPLE_COUNT,
  trailSampleCount = DEFAULT_TRAIL_SAMPLE_COUNT,
} = {}) {
  if (!hasOrbit(orbitRecord)) return null;
  const model = normalizePerturbationModel(perturbationModel);
  const safeElapsedSeconds = finiteNumber(elapsedSeconds);
  const count = normalizeSampleCount(sampleCount);
  const trailCount = normalizeTrailSampleCount(trailSampleCount);
  const periodSeconds = Math.max(1e-6, finiteNumber(orbitRecord.orbit.periodSeconds, 1));
  const trailSpanSeconds = velocityTrailSpanSeconds(orbitRecord.orbit);

  const samples = Array.from({ length: count + 1 }, (_, index) => {
    const sampleElapsedSeconds = safeElapsedSeconds + (index / count) * periodSeconds;
    return velocityPoint(orbitRecord.orbit, sampleElapsedSeconds, model);
  });

  const trail = Array.from({ length: trailCount }, (_, index) => {
    const fraction = trailCount === 1 ? 1 : index / (trailCount - 1);
    const sampleElapsedSeconds = safeElapsedSeconds - trailSpanSeconds * (1 - fraction);
    return velocityPoint(orbitRecord.orbit, sampleElapsedSeconds, model);
  });

  const current = velocityPoint(orbitRecord.orbit, safeElapsedSeconds, model);

  return {
    id: orbitRecord.id,
    name: orbitRecord.name,
    color: orbitRecord.color,
    orbit: orbitRecord.orbit,
    samples,
    current,
    trail,
    speedKmS: current.speedKmS,
    perturbationModel: model,
  };
}

export function sampleVelocityCircles(records = [], options = {}) {
  if (!Array.isArray(records)) return [];
  return records
    .map((orbitRecord) => sampleVelocityCircle({ orbitRecord, ...options }))
    .filter(Boolean);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
node --test test\velocity-circle.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add js\velocity-circle.mjs test\velocity-circle.test.mjs
git commit -m "feat: add velocity circle sampling"
```

### Task 2: Static UI Contract

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Write the failing static tests**

Update `test/static-files.test.mjs`.

In `static app entrypoint uses local offline assets and required modules`, add:

```js
assert.equal(await fileExists('js/velocity-circle.mjs'), true, 'velocity-circle math module should exist');
assert.equal(await fileExists('js/velocity-circle-view.mjs'), true, 'velocity-circle renderer should exist');
```

In `right sidebar module architecture is present`, change the module loop:

```js
for (const moduleName of ['workbench', 'groundTrack', 'velocityCircle', 'assets', 'info', 'console', 'settings']) {
  assert.match(html, new RegExp(`data-module-nav="${moduleName}"`), `${moduleName} nav button should exist`);
}
```

Add order and pin checks:

```js
const groundTrackIndex = html.indexOf('data-module-nav="groundTrack"');
const velocityCircleIndex = html.indexOf('data-module-nav="velocityCircle"');
const assetsIndex = html.indexOf('data-module-nav="assets"');
assert.ok(groundTrackIndex >= 0 && velocityCircleIndex > groundTrackIndex, 'velocity circle nav should follow ground-track nav');
assert.ok(assetsIndex > velocityCircleIndex, 'assets nav should follow velocity circle nav');
assert.match(html, /data-module-pin="velocityCircle"/, 'velocity-circle panel should have a pin button');
```

Add a new test block after the existing ground-track contract assertions:

```js
test('velocity-circle static UI contract is present', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('styles.css', 'utf8');

  assert.match(html, /id="velocity-circle-panel"/, 'velocity-circle panel should exist');
  assert.match(html, /aria-label="速度矢量圆"/, 'velocity-circle panel should be labeled');
  assert.match(html, /id="velocity-circle-canvas"/, 'velocity-circle canvas should exist');
  assert.match(html, /id="velocity-circle-tooltip"/, 'velocity-circle tooltip should exist');
  assert.match(html, /id="velocity-circle-filter-list"/, 'velocity-circle filter list should exist');
  assert.match(html, /id="velocity-circle-readout"/, 'velocity-circle readout should exist');
  assert.match(html, /id="velocity-circle-minimize"/, 'velocity-circle panel should support minimize');
  assert.match(html, /id="velocity-circle-mode-toggle"/, 'velocity-circle panel should support window/fullscreen toggle');
  assert.match(html, /id="velocity-circle-close"/, 'velocity-circle panel should support close');
  assert.match(html, /id="export-velocity-circle-png"/, 'assets should export velocity-circle PNG');
  assert.match(css, /\.velocity-circle-panel/, 'CSS should style velocity-circle panel');
  assert.match(css, /\.velocity-circle-panel\.is-fullscreen/, 'CSS should style velocity-circle fullscreen mode');
  assert.match(css, /\.velocity-circle-filter-row/, 'CSS should style velocity-circle filters');
});
```

- [ ] **Step 2: Run the static test to verify it fails**

Run:

```powershell
node --test test\static-files.test.mjs
```

Expected: FAIL on missing `velocityCircle` nav, panel, renderer file, and export button.

- [ ] **Step 3: Add the HTML contract**

In `index.html`, add the velocity-circle panel after the ground-track panel and before the console panel:

```html
<aside id="velocity-circle-panel" class="velocity-circle-panel" aria-label="速度矢量圆">
  <div class="velocity-circle-header">
    <div>
      <p class="eyebrow">Velocity Circle</p>
      <h2>速度矢量圆</h2>
    </div>
    <div class="velocity-circle-toolbar" aria-label="速度矢量圆工具">
      <button class="pin-button" type="button" aria-label="固定速度圆" data-module-pin="velocityCircle" aria-pressed="false">
        <svg class="button-icon pin-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 3l7 7-3 1-4 7-2-2-5 5-2-2 5-5-2-2 7-4 1-3z"></path>
        </svg>
      </button>
      <button id="velocity-circle-minimize" class="icon-control-button" type="button" aria-label="最小化速度圆模块" title="最小化">
        <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg>
      </button>
      <button id="velocity-circle-mode-toggle" class="icon-control-button" type="button" aria-label="切换窗口或全屏" title="窗口 / 全屏">
        <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>
      </button>
      <button id="velocity-circle-close" class="icon-control-button" type="button" aria-label="关闭速度圆模块" title="关闭">×</button>
    </div>
  </div>
  <div class="velocity-circle-body">
    <section class="velocity-circle-scene-shell" aria-label="速度空间三维视图">
      <canvas id="velocity-circle-canvas"></canvas>
      <div id="velocity-circle-tooltip" class="velocity-circle-tooltip" hidden></div>
    </section>
    <aside class="velocity-circle-sidebar" aria-label="速度圆设置">
      <section class="velocity-circle-section-panel">
        <h3>速度圆轨道选择</h3>
        <div id="velocity-circle-filter-list" class="velocity-circle-filter-list"></div>
      </section>
      <section class="velocity-circle-section-panel">
        <h3>速度矢量读数</h3>
        <div id="velocity-circle-readout" class="velocity-circle-readout">悬停速度矢量后显示读数。</div>
      </section>
    </aside>
  </div>
</aside>
```

In the sidebar nav, insert this button between `groundTrack` and `assets`:

```html
<button class="module-nav-button" type="button" data-module-nav="velocityCircle" aria-label="速度圆">
  <span class="module-nav-icon">◌</span>
  <span>速度圆</span>
</button>
```

In the assets panel export section, add this button after `export-ground-track-png`:

```html
<button id="export-velocity-circle-png" type="button">导出速度圆</button>
```

- [ ] **Step 4: Add CSS for the static layout**

In `styles.css`, add velocity-circle styles beside the ground-track panel styles:

```css
.velocity-circle-panel {
  position: fixed;
  right: calc(var(--module-sidebar-width) + 24px);
  bottom: var(--bottom-action-top-gap);
  z-index: 25;
  width: min(860px, calc(100vw - var(--module-sidebar-width) - 72px));
  height: min(520px, calc(100vh - 168px));
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(150, 190, 184, 0.24);
  border-radius: 8px;
  background: rgba(7, 16, 22, 0.94);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
  opacity: 0;
  pointer-events: none;
  transform: translateY(18px);
  transition: opacity 180ms ease, transform 180ms ease;
}

.velocity-circle-panel.is-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.velocity-circle-panel.is-minimized,
.velocity-circle-panel:not(.is-open) {
  opacity: 0;
  pointer-events: none;
}

.velocity-circle-panel.is-fullscreen {
  top: 24px;
  right: calc(var(--module-sidebar-width) + 24px);
  bottom: var(--bottom-action-top-gap);
  left: 24px;
  width: auto;
  height: auto;
}

body.side-panel-open .velocity-circle-panel {
  right: calc(var(--module-sidebar-width) + var(--module-panel-width) + 24px);
}

body.side-panel-open .velocity-circle-panel.is-fullscreen {
  right: calc(var(--module-sidebar-width) + var(--module-panel-width) + 24px);
}

.velocity-circle-header,
.velocity-circle-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.velocity-circle-header h2 {
  margin: 0;
  font-size: 18px;
}

.velocity-circle-toolbar {
  justify-content: flex-end;
}

.velocity-circle-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 12px;
}

.velocity-circle-panel.is-fullscreen .velocity-circle-body {
  grid-template-columns: minmax(0, 1fr) 280px;
}

.velocity-circle-scene-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(150, 190, 184, 0.18);
  border-radius: 8px;
  background: radial-gradient(circle at center, rgba(18, 38, 46, 0.9), rgba(5, 14, 20, 0.98));
}

#velocity-circle-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.velocity-circle-tooltip {
  position: absolute;
  z-index: 3;
  max-width: 280px;
  padding: 10px 12px;
  border: 1px solid rgba(127, 209, 199, 0.52);
  border-radius: 8px;
  background: rgba(8, 19, 27, 0.94);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.velocity-circle-tooltip[hidden] {
  display: none;
}

.velocity-circle-sidebar {
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}

.velocity-circle-section-panel {
  padding: 12px;
  border: 1px solid rgba(150, 190, 184, 0.16);
  border-radius: 8px;
  background: rgba(9, 22, 31, 0.72);
}

.velocity-circle-section-panel h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text);
}

.velocity-circle-filter-list,
.velocity-circle-readout {
  display: grid;
  gap: 8px;
}

.velocity-circle-filter-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 7px;
  background: rgba(5, 14, 20, 0.42);
}

.velocity-circle-filter-row span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.velocity-circle-color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 12px currentColor;
}
```

- [ ] **Step 5: Run the static test to verify it passes**

Run:

```powershell
node --test test\static-files.test.mjs
```

Expected: PASS for the static UI checks that do not require app wiring.

- [ ] **Step 6: Commit**

Run:

```powershell
git add index.html styles.css test\static-files.test.mjs
git commit -m "feat: add velocity circle panel shell"
```

### Task 3: Three.js Velocity-Circle View

**Files:**
- Create: `js/velocity-circle-view.mjs`
- Create: `test/velocity-circle-view.test.mjs`

- [ ] **Step 1: Write the failing view-helper tests**

Create `test/velocity-circle-view.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVelocityHitPayload,
  formatVelocityNumber,
  velocityBounds,
  velocitySceneScale,
  velocityVectorToScene,
  VelocityCircleView,
} from '../js/velocity-circle-view.mjs';

const track = {
  id: 'orbit-a',
  name: 'Orbit A',
  color: '#7fd1c7',
  current: {
    elapsedSeconds: 42,
    speedKmS: 7.654321,
    velocityKmS: { x: 1.2, y: -2.4, z: 7.1 },
    perturbationModel: 'j2',
  },
  samples: [
    { velocityKmS: { x: 1, y: 0, z: 0 }, speedKmS: 1 },
    { velocityKmS: { x: 0, y: -3, z: 0 }, speedKmS: 3 },
    { velocityKmS: { x: 0, y: 0, z: 6 }, speedKmS: 6 },
  ],
  trail: [
    { velocityKmS: { x: 1, y: 1, z: 1 }, speedKmS: 1.732 },
  ],
};

test('formats velocity numbers for compact tooltip display', () => {
  assert.equal(formatVelocityNumber(7.654321, 3), '7.654');
  assert.equal(formatVelocityNumber(Number.NaN), '--');
});

test('computes finite velocity bounds from samples, current vectors, and trails', () => {
  const bounds = velocityBounds([track]);
  assert.equal(bounds.maxAbsComponent, 7.1);
  assert.equal(bounds.maxSpeedKmS, 7.654321);
  assert.ok(bounds.radiusKmS >= 7.654321);
});

test('computes a nonzero scene scale for velocity-space rendering', () => {
  const scale = velocitySceneScale(velocityBounds([track]));
  assert.ok(scale > 0);
  const point = velocityVectorToScene(track.current.velocityKmS, scale);
  assert.ok(Number.isFinite(point.x));
  assert.ok(Number.isFinite(point.y));
  assert.ok(Number.isFinite(point.z));
});

test('builds hover payloads with orbit name, speed, vector components, and dynamics model', () => {
  const payload = buildVelocityHitPayload(track, track.current);
  assert.equal(payload.id, 'orbit-a');
  assert.equal(payload.name, 'Orbit A');
  assert.equal(payload.speedKmS, 7.654321);
  assert.equal(payload.perturbationModel, 'j2');
  assert.deepEqual(payload.velocityKmS, { x: 1.2, y: -2.4, z: 7.1 });
});

test('view methods are safe when no canvas is available', () => {
  const view = new VelocityCircleView({});
  assert.doesNotThrow(() => view.setPanelOpen(false));
  assert.doesNotThrow(() => view.setFullscreen(true));
  assert.doesNotThrow(() => view.setData([track], { selectedIds: ['orbit-a'], elapsedSeconds: 42 }));
  assert.equal(view.capturePng({ width: 320, height: 180 }), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --test test\velocity-circle-view.test.mjs
```

Expected: FAIL with an import error because `js/velocity-circle-view.mjs` does not exist.

- [ ] **Step 3: Implement the view helpers and class skeleton**

Create `js/velocity-circle-view.mjs` with these exports and helper functions:

```js
import * as THREE from '../vendor/three.module.js';

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(3.4, 2.5, 4.2);
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 1, 0);
const AXIS_LENGTH_SCENE = 1.25;
const MIN_RADIUS_KMS = 1;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteVector(vector = {}) {
  return {
    x: finiteNumber(vector.x),
    y: finiteNumber(vector.y),
    z: finiteNumber(vector.z),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hexColor(hex, fallback = 0x7fd1c7) {
  return /^#[\da-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : fallback;
}

export function formatVelocityNumber(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return '--';
  return Number(value).toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function velocityBounds(tracks = []) {
  let maxAbsComponent = 0;
  let maxSpeedKmS = 0;
  for (const track of tracks ?? []) {
    for (const point of [
      ...(track.samples ?? []),
      ...(track.trail ?? []),
      track.current,
    ].filter(Boolean)) {
      const velocity = finiteVector(point.velocityKmS);
      maxAbsComponent = Math.max(maxAbsComponent, Math.abs(velocity.x), Math.abs(velocity.y), Math.abs(velocity.z));
      maxSpeedKmS = Math.max(maxSpeedKmS, finiteNumber(point.speedKmS));
    }
  }
  const radiusKmS = Math.max(MIN_RADIUS_KMS, maxSpeedKmS, maxAbsComponent);
  return { maxAbsComponent, maxSpeedKmS, radiusKmS };
}

export function velocitySceneScale(bounds = {}) {
  return AXIS_LENGTH_SCENE / Math.max(MIN_RADIUS_KMS, finiteNumber(bounds.radiusKmS, MIN_RADIUS_KMS));
}

export function velocityVectorToScene(vector = {}, scale = 1) {
  const safe = finiteVector(vector);
  return new THREE.Vector3(safe.x * scale, safe.z * scale, -safe.y * scale);
}

export function buildVelocityHitPayload(track, point = track?.current) {
  const velocityKmS = finiteVector(point?.velocityKmS);
  return {
    id: track?.id ?? '',
    name: track?.name ?? '',
    color: track?.color ?? '#7fd1c7',
    speedKmS: finiteNumber(point?.speedKmS),
    velocityKmS,
    elapsedSeconds: finiteNumber(point?.elapsedSeconds),
    perturbationModel: point?.perturbationModel ?? track?.perturbationModel ?? 'two-body',
  };
}
```

Add `VelocityCircleView` with these method responsibilities:

```js
export class VelocityCircleView {
  constructor({
    canvas = null,
    tooltip = null,
    readout = null,
  } = {}) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.readout = readout;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;
    this.trackRoot = null;
    this.axesRoot = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickTargets = [];
    this.tracks = [];
    this.selectedIds = [];
    this.bounds = velocityBounds([]);
    this.scale = velocitySceneScale(this.bounds);
    this.isPanelOpen = false;
    this.isFullscreen = false;
    this.dragState = null;
    this.cameraDistance = DEFAULT_CAMERA_POSITION.length();
    this.cameraTheta = Math.atan2(DEFAULT_CAMERA_POSITION.z, DEFAULT_CAMERA_POSITION.x);
    this.cameraPhi = Math.acos(DEFAULT_CAMERA_POSITION.y / this.cameraDistance);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);

    if (this.canvas?.getContext) {
      this.initThree();
      this.bindEvents();
      this.resize();
      this.render();
    }
  }

  initThree() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.root = new THREE.Group();
    this.axesRoot = new THREE.Group();
    this.trackRoot = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.axesRoot, this.trackRoot);
    this.buildAxes();
    this.updateCamera();
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', () => this.hideTooltip());
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  setPanelOpen(isPanelOpen) {
    this.isPanelOpen = Boolean(isPanelOpen);
    if (this.isPanelOpen) {
      this.resize();
      this.render();
    }
  }

  setFullscreen(isFullscreen) {
    this.isFullscreen = Boolean(isFullscreen);
    this.resize();
    this.render();
  }

  setData(tracks = [], options = {}) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.selectedIds = Array.isArray(options.selectedIds) ? [...new Set(options.selectedIds.filter(Boolean))] : [];
    this.bounds = velocityBounds(this.tracks);
    this.scale = velocitySceneScale(this.bounds);
    if (this.trackRoot) this.rebuildTracks();
    this.render();
  }

  resize() {
    if (!this.canvas || !this.renderer || !this.camera) return false;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) return false;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    return true;
  }

  capturePng({ width = null, height = null } = {}) {
    if (!this.renderer || !this.canvas) return '';
    const targetWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : this.canvas.width;
    const targetHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : this.canvas.height;
    const previousSize = new THREE.Vector2();
    this.renderer.getSize(previousSize);
    this.renderer.setSize(targetWidth, targetHeight, false);
    this.camera.aspect = targetWidth / targetHeight;
    this.camera.updateProjectionMatrix();
    this.render();
    const png = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setSize(previousSize.x, previousSize.y, false);
    this.resize();
    return png;
  }
}
```

Implement these class methods in the same file:

- `buildAxes()`: create three `THREE.Line` axes labeled by color convention using simple line geometry. Use x red-green tint, y teal tint, z yellow tint.
- `rebuildTracks()`: dispose existing children in `trackRoot`, rebuild a line for each `samples`, a line for each `trail`, a current endpoint sphere, and a current arrow line from origin to `current.velocityKmS`.
- `disposeObject(object)`: dispose geometry and material recursively.
- `makeLine(points, color, opacity, lineWidth = 1)`: map velocity vectors through `velocityVectorToScene`.
- `makeEndpoint(track)`: sphere mesh at current endpoint with `userData.velocityHit`.
- `makeArrow(track)`: line from origin to current endpoint with `userData.velocityHit`.
- `updateCamera()`: convert `cameraTheta`, `cameraPhi`, and `cameraDistance` to camera position and look at origin.
- `onPointerDown`, `onPointerMove`, `onPointerUp`: left-drag changes `cameraTheta` and `cameraPhi`, then calls `updateCamera()` and `render()`.
- `onWheel`: prevent default, scale `cameraDistance` with clamp `2.2..12`, then render.
- `updateHover(event)`: raycast against `pickTargets`, show tooltip and readout when a hit target has `userData.velocityHit`.
- `showTooltip(payload, event)` and `hideTooltip()`.
- `render()`: call `renderer.render(scene, camera)` when renderer exists.

Use this tooltip HTML:

```js
function velocityTooltipHtml(payload) {
  return `
    <strong>${escapeHtml(payload.name)}</strong>
    <dl>
      <dt>速度大小</dt><dd>${formatVelocityNumber(payload.speedKmS, 4)} km/s</dd>
      <dt>vx</dt><dd>${formatVelocityNumber(payload.velocityKmS.x, 4)} km/s</dd>
      <dt>vy</dt><dd>${formatVelocityNumber(payload.velocityKmS.y, 4)} km/s</dd>
      <dt>vz</dt><dd>${formatVelocityNumber(payload.velocityKmS.z, 4)} km/s</dd>
      <dt>仿真时刻</dt><dd>${formatVelocityNumber(payload.elapsedSeconds, 2)} s</dd>
      <dt>动力学</dt><dd>${escapeHtml(payload.perturbationModel)}</dd>
    </dl>
  `;
}
```

- [ ] **Step 4: Run the view-helper test to verify it passes**

Run:

```powershell
node --test test\velocity-circle-view.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add js\velocity-circle-view.mjs test\velocity-circle-view.test.mjs
git commit -m "feat: render velocity circle view"
```

### Task 4: App State, Panel Logic, and PNG Export

**Files:**
- Modify: `js/app.mjs`
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Write failing app-wiring static tests**

Add to `velocity-circle static UI contract is present` in `test/static-files.test.mjs`:

```js
const app = await readFile('js/app.mjs', 'utf8');

assert.match(app, /sampleVelocityCircles/, 'app should import velocity-circle sampling');
assert.match(app, /VelocityCircleView/, 'app should import velocity-circle renderer');
assert.match(app, /velocityCirclePanel:\s*'closed'/, 'app should track velocity-circle panel state');
assert.match(app, /velocityCircleFilters:\s*\{\}/, 'app should track velocity-circle filters');
assert.match(app, /setVelocityCirclePanel/, 'app should set velocity-circle panel modes');
assert.match(app, /syncVelocityCircleFilters/, 'app should sync velocity-circle filters from visible orbits');
assert.match(app, /renderVelocityCircle/, 'app should render velocity-circle data');
assert.match(app, /exportVelocityCirclePng/, 'app should export velocity-circle PNG');
assert.match(app, /function exportVelocityCirclePng[\s\S]*velocityCircleView\.capturePng\(\{ width: 1920, height: 1080 \}\)/, 'velocity-circle PNG export should use fixed 1920x1080 size');
assert.match(app, /velocityCirclePanel !== 'closed'/, 'tick should skip closed velocity-circle background work');
assert.match(app, /state\.velocityCircleFilters\[id\] = true/, 'new velocity-circle filters should default on');
```

- [ ] **Step 2: Run the static test to verify it fails**

Run:

```powershell
node --test test\static-files.test.mjs
```

Expected: FAIL because `js/app.mjs` has no velocity-circle wiring.

- [ ] **Step 3: Add imports, elements, view instance, and state**

In `js/app.mjs`, add imports:

```js
import {
  sampleVelocityCircles,
} from './velocity-circle.mjs';
import { VelocityCircleView } from './velocity-circle-view.mjs';
```

Change module sets:

```js
const BOTTOM_MODULES = new Set(['groundTrack', 'velocityCircle', 'console']);
```

Add elements to `els`:

```js
velocityCirclePanel: document.querySelector('#velocity-circle-panel'),
velocityCircleModeToggle: document.querySelector('#velocity-circle-mode-toggle'),
velocityCircleMinimize: document.querySelector('#velocity-circle-minimize'),
velocityCircleClose: document.querySelector('#velocity-circle-close'),
velocityCircleCanvas: document.querySelector('#velocity-circle-canvas'),
velocityCircleTooltip: document.querySelector('#velocity-circle-tooltip'),
velocityCircleFilterList: document.querySelector('#velocity-circle-filter-list'),
velocityCircleReadout: document.querySelector('#velocity-circle-readout'),
exportVelocityCirclePng: document.querySelector('#export-velocity-circle-png'),
```

Instantiate the view after `groundTrackView`:

```js
const velocityCircleView = new VelocityCircleView({
  canvas: els.velocityCircleCanvas,
  tooltip: els.velocityCircleTooltip,
  readout: els.velocityCircleReadout,
});
```

Add state fields:

```js
velocityCirclePanel: 'closed',
velocityCircleFilters: {},
velocityCircleTracks: [],
lastVelocityCircleRenderMs: 0,
velocityCircleExportNamePrefix: 'velocity-circle',
```

Add `velocityCircle: false` to `state.modulePins`.

- [ ] **Step 4: Persist and restore velocity-circle state**

In `saveState()`, add:

```js
velocityCirclePanel: state.velocityCirclePanel,
velocityCircleFilters: state.velocityCircleFilters,
velocityCircleExportNamePrefix: state.velocityCircleExportNamePrefix,
```

In `restoreState()`, add:

```js
if (['closed', 'window', 'fullscreen', 'minimized'].includes(payload?.velocityCirclePanel)) {
  state.velocityCirclePanel = payload.velocityCirclePanel;
}
if (payload?.velocityCircleFilters && typeof payload.velocityCircleFilters === 'object') {
  state.velocityCircleFilters = { ...payload.velocityCircleFilters };
}
if (typeof payload?.velocityCircleExportNamePrefix === 'string') {
  state.velocityCircleExportNamePrefix = payload.velocityCircleExportNamePrefix;
}
```

In `serializeWorkbenchSnapshot()`, add:

```js
velocityCircleFilters: { ...state.velocityCircleFilters },
```

In `applyWorkbenchSnapshot(snapshot = {})`, add:

```js
if (snapshot.velocityCircleFilters && typeof snapshot.velocityCircleFilters === 'object') {
  state.velocityCircleFilters = { ...snapshot.velocityCircleFilters };
}
state.velocityCircleTracks = [];
```

- [ ] **Step 5: Wire module state and sidebar behavior**

In `applyModuleState()`, include velocity circle in the body class loop:

```js
for (const moduleName of ['workbench', 'assets', 'settings', 'groundTrack', 'velocityCircle', 'console']) {
  els.body.classList.toggle(`module-${moduleName}-open`, active === moduleName);
}
```

Add panel class toggles:

```js
const velocityCircleOpen = active === 'velocityCircle' && state.velocityCirclePanel !== 'minimized';
els.velocityCirclePanel.classList.toggle('is-open', velocityCircleOpen);
els.velocityCirclePanel.classList.toggle('is-minimized', state.velocityCirclePanel === 'minimized');
els.velocityCirclePanel.classList.toggle('is-fullscreen', state.velocityCirclePanel === 'fullscreen');
velocityCircleView.setPanelOpen(velocityCircleOpen);
velocityCircleView.setFullscreen(state.velocityCirclePanel === 'fullscreen');
```

In `openModule(moduleName, { preview = false } = {})`, add:

```js
if (moduleName === 'velocityCircle' && ['closed', 'minimized'].includes(state.velocityCirclePanel)) {
  state.velocityCirclePanel = 'window';
}
```

After the ground-track render branch, add:

```js
if (moduleName === 'velocityCircle') {
  renderVelocityCircle({ force: true });
}
```

In `toggleModuleFromSidebar(moduleName)`, add before the active-module check:

```js
if (moduleName === 'velocityCircle' && state.velocityCirclePanel === 'minimized') {
  setVelocityCirclePanel('window', { confirmClose: false });
  return;
}
```

In `closeActiveModule()`, add:

```js
if (state.activeModule === 'velocityCircle') {
  setVelocityCirclePanel('closed');
  return;
}
```

- [ ] **Step 6: Add filters and data generation helpers**

Add these functions near the ground-track helpers:

```js
function velocityCircleSampleCount(budget) {
  return Math.max(36, Math.min(360, Math.floor(Number(budget.groundTrackSamplesPerRev) || 160)));
}

function velocityCircleTrailSampleCount(budget) {
  return Math.max(8, Math.min(48, Math.floor(velocityCircleSampleCount(budget) / 6)));
}

function syncVelocityCircleFilters() {
  const visibleIds = new Set(state.orbits.filter((orbit) => orbit.visible).map((orbit) => orbit.id));
  for (const id of Object.keys(state.velocityCircleFilters)) {
    if (!visibleIds.has(id)) delete state.velocityCircleFilters[id];
  }
  for (const id of visibleIds) {
    if (typeof state.velocityCircleFilters[id] !== 'boolean') state.velocityCircleFilters[id] = true;
  }
}

function activeVelocityCircleRecords(budget) {
  syncVelocityCircleFilters();
  const maxTracks = Math.max(1, Math.floor(Number(budget.mapCacheTracks) || state.orbits.length || 1));
  return state.orbits
    .filter((orbit) => orbit.visible && state.velocityCircleFilters[orbit.id] !== false)
    .slice(0, maxTracks);
}

function rebuildVelocityCircleTracks(records = null) {
  const budget = currentGroundTrackBudget();
  const activeRecords = records ?? activeVelocityCircleRecords(budget);
  state.velocityCircleTracks = sampleVelocityCircles(activeRecords, {
    elapsedSeconds: state.elapsedSeconds,
    perturbationModel: state.perturbationModel,
    sampleCount: velocityCircleSampleCount(budget),
    trailSampleCount: velocityCircleTrailSampleCount(budget),
  });
  return state.velocityCircleTracks;
}

function renderVelocityCircleFilters() {
  syncVelocityCircleFilters();
  els.velocityCircleFilterList.innerHTML = '';
  const visibleOrbits = state.orbits.filter((orbit) => orbit.visible);
  if (visibleOrbits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '暂无可见轨道';
    els.velocityCircleFilterList.append(empty);
    return;
  }

  for (const record of visibleOrbits) {
    const label = document.createElement('label');
    label.className = 'velocity-circle-filter-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.velocityCircleFilters[record.id] !== false;
    input.dataset.velocityCircleFilter = record.id;

    const name = document.createElement('span');
    name.textContent = record.name;

    const swatch = document.createElement('span');
    swatch.className = 'velocity-circle-color-swatch';
    swatch.style.color = record.color;

    input.addEventListener('change', () => {
      state.velocityCircleFilters[record.id] = input.checked;
      markSceneDirty();
      renderVelocityCircle({ force: true });
      saveState();
    });

    label.append(input, name, swatch);
    els.velocityCircleFilterList.append(label);
  }
}
```

- [ ] **Step 7: Add panel setter, render, and export functions**

Add these functions near `setGroundTrackPanel`:

```js
function shouldConfirmVelocityCircleClose() {
  return state.isPlaying && Object.values(state.velocityCircleFilters).some(Boolean);
}

function setVelocityCirclePanel(mode, { confirmClose = true } = {}) {
  const nextMode = ['window', 'fullscreen', 'minimized'].includes(mode) ? mode : 'closed';
  if (nextMode === 'closed' && confirmClose && shouldConfirmVelocityCircleClose()) {
    const confirmed = window.confirm('当前仿真正在运行。关闭速度圆模块将停止该模块更新，是否继续？');
    if (!confirmed) return;
  }
  state.velocityCirclePanel = nextMode;
  if (nextMode === 'closed') {
    state.velocityCircleTracks = [];
    if (state.activeModule === 'velocityCircle') {
      state.activeModule = null;
      state.committedModule = null;
    }
  } else {
    state.activeModule = 'velocityCircle';
    state.committedModule = 'velocityCircle';
  }
  applyModuleState();
  if (!['closed', 'minimized'].includes(state.velocityCirclePanel)) {
    requestAnimationFrame(() => renderVelocityCircle({ force: true }));
  }
  saveState();
}

function renderVelocityCircle(options = {}) {
  const isOpen = state.activeModule === 'velocityCircle' && !['closed', 'minimized'].includes(state.velocityCirclePanel);
  velocityCircleView.setPanelOpen(isOpen);
  velocityCircleView.setFullscreen(state.velocityCirclePanel === 'fullscreen');
  if (!isOpen) return;

  const nowMs = performance.now();
  const minIntervalMs = state.isPlaying ? 180 : 700;
  if (!options.force && nowMs - state.lastVelocityCircleRenderMs < minIntervalMs) {
    velocityCircleView.setData(state.velocityCircleTracks, {
      selectedIds: state.selectedIds,
      elapsedSeconds: state.elapsedSeconds,
      isPlaying: state.isPlaying,
    });
    return;
  }

  state.lastVelocityCircleRenderMs = nowMs;
  rebuildVelocityCircleTracks();
  velocityCircleView.setData(state.velocityCircleTracks, {
    selectedIds: state.selectedIds,
    elapsedSeconds: state.elapsedSeconds,
    isPlaying: state.isPlaying,
  });
}

function exportVelocityCirclePng() {
  const previousTracks = state.velocityCircleTracks;
  rebuildVelocityCircleTracks();
  velocityCircleView.setData(state.velocityCircleTracks, {
    selectedIds: state.selectedIds,
    elapsedSeconds: state.elapsedSeconds,
    isPlaying: false,
  });
  const png = velocityCircleView.capturePng({ width: 1920, height: 1080 });
  state.velocityCircleTracks = previousTracks.length > 0 ? previousTracks : state.velocityCircleTracks;
  downloadDataUrl(`${state.velocityCircleExportNamePrefix}-${currentTimestampLabel()}.png`, png);
}
```

- [ ] **Step 8: Bind controls and lifecycle refreshes**

In `bindEvents()`, add after ground-track panel button handlers:

```js
els.velocityCircleModeToggle.addEventListener('click', () => {
  setVelocityCirclePanel(state.velocityCirclePanel === 'fullscreen' ? 'window' : 'fullscreen');
});
els.velocityCircleMinimize.addEventListener('click', () => setVelocityCirclePanel('minimized', { confirmClose: false }));
els.velocityCircleClose.addEventListener('click', () => setVelocityCirclePanel('closed'));
els.exportVelocityCirclePng.addEventListener('click', exportVelocityCirclePng);
```

In the resize listener, add:

```js
velocityCircleView.resize();
renderVelocityCircle({ force: true });
```

In `renderUi()`, add after ground-track UI updates:

```js
renderVelocityCircleFilters();
renderVelocityCircle({ force: true });
```

In `tick(nowMs)`, add after ground-track rendering:

```js
if (state.velocityCirclePanel !== 'closed') renderVelocityCircle();
```

In orbit mutation paths, clear cached velocity-circle data with this exact line:

```js
state.velocityCircleTracks = [];
```

Add it in these exact locations:

```js
// In the perturbation-model click handler, directly after clearGroundTrackHistories();
state.velocityCircleTracks = [];

// In the orbit form submit handler, directly after clearGroundTrackHistories(record.id); for replacements
// and directly after state.orbits.push(record); for additions.
state.velocityCircleTracks = [];

// In removeOrbit(id), directly after clearGroundTrackHistories(id);
state.velocityCircleTracks = [];

// In toggleOrbitVisibility(id), directly after the existing clearGroundTrackHistories(id) branch.
state.velocityCircleTracks = [];

// In clearCurrentSceneWithConfirmation(), directly after clearGroundTrackHistories();
state.velocityCircleTracks = [];

// In importJson(file), directly after clearGroundTrackHistories();
state.velocityCircleTracks = [];

// In importTxt(file), directly after clearGroundTrackHistories();
state.velocityCircleTracks = [];
```

- [ ] **Step 9: Run static tests**

Run:

```powershell
node --test test\static-files.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Run focused module tests**

Run:

```powershell
node --test test\velocity-circle.test.mjs test\velocity-circle-view.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```powershell
git add js\app.mjs test\static-files.test.mjs
git commit -m "feat: wire velocity circle module"
```

### Task 5: Full Verification and Browser QA

**Files:**
- Modify only if verification exposes a defect in files from Tasks 1-4.

- [ ] **Step 1: Run the full automated test suite**

Run:

```powershell
node --test
```

Expected: PASS.

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
node --check js\app.mjs
node --check js\scene.mjs
node --check js\orbit.mjs
node --check js\velocity-circle.mjs
node --check js\velocity-circle-view.mjs
```

Expected: each command exits with code 0 and prints no syntax error.

- [ ] **Step 3: Start a local server for rendered QA**

Run:

```powershell
$env:PORT='4181'
node server.mjs
```

Expected: local static server starts at `http://127.0.0.1:4181`.

- [ ] **Step 4: Browser QA**

Open `http://127.0.0.1:4181` and verify:

- App loads with no console errors.
- Sidebar order is 工作台, 星下点, 速度圆, 资产.
- Add one orbit and open 速度圆.
- The velocity-circle panel opens in window mode.
- Drag rotates the 3D velocity space.
- Wheel zooms the velocity space.
- Running the simulation updates the current arrow and short trail.
- Hovering a current endpoint or reference line shows speed, `vx/vy/vz`, sim time, and dynamics model.
- Add a second orbit; both appear by default in the velocity-circle filter list.
- Unchecking one velocity-circle filter hides that track only in the velocity-circle module.
- Selecting one orbit in the main orbit list enhances it in the velocity-circle view.
- Window/fullscreen/minimize/close controls match ground-track behavior.
- Open assets panel and click `导出速度圆`; a `velocity-circle-*.png` download is produced at 1920x1080.

- [ ] **Step 5: Stop the local server**

Stop the `node server.mjs` process started in Step 3.

- [ ] **Step 6: Commit verification fixes if any were required**

If Step 4 required changes, run:

```powershell
git add index.html styles.css js\app.mjs js\velocity-circle.mjs js\velocity-circle-view.mjs test\static-files.test.mjs test\velocity-circle.test.mjs test\velocity-circle-view.test.mjs
git commit -m "fix: verify velocity circle module"
```

Expected: commit includes only files changed to fix verification defects.
