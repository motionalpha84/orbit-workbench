# Multi-Vector Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the workbench vector calibration tool so users can define multiple named ECI targets, choose position or velocity per target, run them together, and see grouped named results and markers.

**Architecture:** Keep the existing single-target `calibrateOrbitVectors(...)` solver as the numeric core. Add a batch wrapper in `js/vector-calibration.mjs`, preserve target metadata in scene marker normalization, then replace the single-vector DOM flow in `js/app.mjs` with a rendered target-row list and grouped result rendering. Static UI, solver, scene, and browser behavior are verified independently.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript ES modules, vendored Three.js, Node built-in test runner, local `server.mjs` for browser QA.

---

## File Structure

- Modify `js/vector-calibration.mjs`: add target normalization and `calibrateOrbitVectorTargets(records, options)` while leaving `calibrateOrbitVectors(...)` intact for single-target behavior.
- Modify `test/vector-calibration.test.mjs`: add batch solver tests for mixed position/velocity targets, target-name propagation, per-row errors, empty target lists, and duplicate names.
- Modify `js/scene.mjs`: preserve `targetId`, `targetName`, and `targetMode` in normalized calibration marker data.
- Modify `test/scene-calibration.test.mjs`: verify marker target metadata is retained and defaulted.
- Modify `index.html`: replace the single-vector calibration controls with a multi-target row container and action buttons.
- Modify `styles.css`: replace the single-row vector-grid styling with compact row/table-like target-list styles.
- Modify `test/static-files.test.mjs`: update the static contract from single-vector inputs to multi-vector target rows and batch wiring.
- Modify `js/app.mjs`: import the batch solver, maintain `calibrationTargets`, render/edit/delete target rows, run batch calibration, render grouped results, and flatten exact hits into scene markers.

---

### Task 1: Batch Vector Calibration Solver

**Files:**
- Modify: `test/vector-calibration.test.mjs`
- Modify: `js/vector-calibration.mjs`

- [ ] **Step 1: Write failing batch solver tests**

In `test/vector-calibration.test.mjs`, update the import block to include `calibrateOrbitVectorTargets`:

```js
import {
  calibrateOrbitVectorTargets,
  calibrateOrbitVectors,
  calibrationResidual,
  normalizeCalibrationMode,
  parseCalibrationVector,
} from '../js/vector-calibration.mjs';
```

Append these tests to the end of the file:

```js
test('batch calibration solves independent named position and velocity targets', () => {
  const record = orbitRecord({ id: 'mixed-target-orbit', name: 'Mixed Target Orbit' });
  const positionElapsedSeconds = 1345.25;
  const velocityElapsedSeconds = 2450.75;
  const positionTarget = propagateOrbit(record.orbit, positionElapsedSeconds, { perturbationModel: 'two-body' }).positionKm;
  const velocityTarget = propagateOrbit(record.orbit, velocityElapsedSeconds, { perturbationModel: 'two-body' }).velocityKmS;

  const result = calibrateOrbitVectorTargets([record], {
    targets: [
      {
        id: 'target-position',
        name: '目标位置A',
        mode: 'position',
        vector: positionTarget,
      },
      {
        id: 'target-velocity',
        name: '近地点速度',
        mode: 'velocity',
        vector: velocityTarget,
      },
    ],
    perturbationModel: 'two-body',
    sampleCount: 128,
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.targets.length, 2);
  assert.equal(result.hits.length, 2);
  assert.equal(result.targets[0].targetName, '目标位置A');
  assert.equal(result.targets[0].mode, 'position');
  assert.equal(result.targets[0].result.status, 'hit');
  assert.equal(result.targets[1].targetName, '近地点速度');
  assert.equal(result.targets[1].mode, 'velocity');
  assert.equal(result.targets[1].result.status, 'hit');
  assert.ok(result.hits.every((hit) => hit.targetId === 'target-position' || hit.targetId === 'target-velocity'));
  assert.ok(result.hits.some((hit) => hit.targetName === '目标位置A'));
  assert.ok(result.hits.some((hit) => hit.targetName === '近地点速度'));
});

test('batch calibration gives every hit from one target the same target name', () => {
  const first = orbitRecord({ id: 'same-a', name: 'Same Orbit A' });
  const second = orbitRecord({ id: 'same-b', name: 'Same Orbit B' });
  const target = propagateOrbit(first.orbit, 1200, { perturbationModel: 'two-body' }).positionKm;

  const result = calibrateOrbitVectorTargets([first, second], {
    targets: [
      {
        id: 'shared-name-target',
        name: '共享命名点',
        mode: 'position',
        vector: target,
      },
    ],
    perturbationModel: 'two-body',
    sampleCount: 128,
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].result.status, 'hit');
  assert.equal(result.targets[0].result.hits.length, 2);
  assert.deepEqual(result.targets[0].result.hits.map((hit) => hit.targetName), ['共享命名点', '共享命名点']);
  assert.deepEqual(result.hits.map((hit) => hit.targetName), ['共享命名点', '共享命名点']);
});

test('batch calibration isolates one target input error from valid targets', () => {
  const record = orbitRecord();
  const target = propagateOrbit(record.orbit, 800, { perturbationModel: 'two-body' }).positionKm;

  const result = calibrateOrbitVectorTargets([record], {
    targets: [
      {
        id: 'bad-target',
        name: '坏输入',
        mode: 'position',
        vector: { x: 'NaN', y: 0, z: 0 },
      },
      {
        id: 'good-target',
        name: '好输入',
        mode: 'position',
        vector: target,
      },
    ],
    perturbationModel: 'two-body',
    sampleCount: 96,
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.targets.length, 2);
  assert.equal(result.targets[0].result.status, 'input-error');
  assert.match(result.targets[0].result.error, /有限数字/);
  assert.equal(result.targets[1].result.status, 'hit');
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].targetId, 'good-target');
});

test('batch calibration reports no valid targets for an empty target list', () => {
  const result = calibrateOrbitVectorTargets([orbitRecord()], {
    targets: [],
    perturbationModel: 'two-body',
    sampleCount: 96,
  });

  assert.equal(result.status, 'no-valid-targets');
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.hits, []);
});

test('batch calibration keeps duplicate target names separate by target id', () => {
  const record = orbitRecord({ id: 'duplicate-name-orbit', name: 'Duplicate Name Orbit' });
  const positionTarget = propagateOrbit(record.orbit, 500, { perturbationModel: 'two-body' }).positionKm;
  const velocityTarget = propagateOrbit(record.orbit, 1400, { perturbationModel: 'two-body' }).velocityKmS;

  const result = calibrateOrbitVectorTargets([record], {
    targets: [
      {
        id: 'duplicate-a',
        name: '同名目标',
        mode: 'position',
        vector: positionTarget,
      },
      {
        id: 'duplicate-b',
        name: '同名目标',
        mode: 'velocity',
        vector: velocityTarget,
      },
    ],
    perturbationModel: 'two-body',
    sampleCount: 128,
  });

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.targets.map((target) => target.targetId), ['duplicate-a', 'duplicate-b']);
  assert.deepEqual(result.targets.map((target) => target.targetName), ['同名目标', '同名目标']);
  assert.ok(result.hits.some((hit) => hit.targetId === 'duplicate-a' && hit.targetName === '同名目标'));
  assert.ok(result.hits.some((hit) => hit.targetId === 'duplicate-b' && hit.targetName === '同名目标'));
});
```

- [ ] **Step 2: Run batch solver tests to verify RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\vector-calibration.test.mjs
```

Expected: FAIL with a module import error similar to:

```text
SyntaxError: The requested module '../js/vector-calibration.mjs' does not provide an export named 'calibrateOrbitVectorTargets'
```

- [ ] **Step 3: Add batch target helpers and solver**

In `js/vector-calibration.mjs`, add these helpers after `sortHits(...)` and before `export function calibrateOrbitVectors(...)`:

```js
function normalizeTargetId(target, index) {
  const rawId = String(target?.id ?? '').trim();
  return rawId || `calibration-target-${index + 1}`;
}

function normalizeTargetName(target, index) {
  const rawName = String(target?.name ?? '').trim();
  return rawName || `标定${index + 1}`;
}

function targetInputError(targetId, targetName, mode, perturbationModel, error) {
  return {
    targetId,
    targetName,
    mode,
    result: {
      status: 'input-error',
      error,
      mode,
      targetVector: null,
      perturbationModel,
      hits: [],
      nearest: null,
    },
  };
}

function decorateStateWithTarget(state, targetId, targetName, mode) {
  if (!state) return null;
  return {
    ...state,
    targetId,
    targetName,
    targetMode: mode,
  };
}

function decorateResultWithTarget(result, targetId, targetName, mode) {
  const hits = Array.isArray(result.hits)
    ? result.hits.map((hit) => decorateStateWithTarget(hit, targetId, targetName, mode))
    : [];
  return {
    ...result,
    hits,
    nearest: decorateStateWithTarget(result.nearest, targetId, targetName, mode),
  };
}
```

Then add this exported function after `calibrateOrbitVectors(...)`:

```js
export function calibrateOrbitVectorTargets(records = [], options = {}) {
  const perturbationModel = normalizePerturbationModel(options.perturbationModel);
  const sampleCount = options.sampleCount;
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const groupedTargets = [];
  const hits = [];
  let validTargetCount = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const targetId = normalizeTargetId(target, index);
    const targetName = normalizeTargetName(target, index);
    const mode = normalizeCalibrationMode(target?.mode);
    const explicitName = String(target?.name ?? '').trim();

    if (!explicitName) {
      groupedTargets.push(targetInputError(targetId, targetName, mode, perturbationModel, '标定名称不能为空。'));
      continue;
    }

    const result = calibrateOrbitVectors(records, {
      mode,
      targetVector: target?.vector,
      perturbationModel,
      sampleCount,
    });
    const decoratedResult = decorateResultWithTarget(result, targetId, targetName, mode);
    groupedTargets.push({
      targetId,
      targetName,
      mode,
      result: decoratedResult,
    });

    if (result.status !== 'input-error') validTargetCount += 1;
    hits.push(...decoratedResult.hits);
  }

  return {
    status: validTargetCount > 0 ? 'complete' : 'no-valid-targets',
    perturbationModel,
    targets: groupedTargets,
    hits,
  };
}
```

- [ ] **Step 4: Run batch solver tests to verify GREEN**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\vector-calibration.test.mjs
```

Expected: PASS for all solver tests.

- [ ] **Step 5: Commit the batch solver**

Run:

```powershell
git add js\vector-calibration.mjs test\vector-calibration.test.mjs
git commit -m "feat: add multi-vector calibration solver"
```

---

### Task 2: Scene Marker Target Metadata

**Files:**
- Modify: `test/scene-calibration.test.mjs`
- Modify: `js/scene.mjs`

- [ ] **Step 1: Write failing scene marker metadata tests**

In `test/scene-calibration.test.mjs`, update the first marker in `normalizes finite calibration marker data` to include target metadata:

```js
{
  targetId: 'target-1',
  targetName: '近地点速度',
  targetMode: 'velocity',
  orbitId: 'orbit-1',
  orbitName: 'Orbit 1',
  color: '#7fd1c7',
  positionKm: { x: 7000, y: 10, z: -20 },
  residual: 0.001,
  elapsedSeconds: 120,
},
```

Add these assertions after `assert.equal(markers[0].orbitId, 'orbit-1');`:

```js
assert.equal(markers[0].targetId, 'target-1');
assert.equal(markers[0].targetName, '近地点速度');
assert.equal(markers[0].targetMode, 'velocity');
```

Append this test to the end of the file:

```js
test('normalizes missing marker target labels', () => {
  const markers = normalizeCalibrationMarkers([
    {
      orbitId: 'orbit-3',
      positionKm: { x: 4, y: 5, z: 6 },
    },
  ]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].targetId, '');
  assert.equal(markers[0].targetName, '未命名标定');
  assert.equal(markers[0].targetMode, 'position');
});
```

- [ ] **Step 2: Run scene marker tests to verify RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\scene-calibration.test.mjs
```

Expected: FAIL because `normalizeCalibrationMarkers(...)` does not yet preserve `targetId`, `targetName`, or `targetMode`.

- [ ] **Step 3: Preserve target metadata in marker normalization**

In `js/scene.mjs`, update the object returned by `normalizeCalibrationMarkers(markers = [])` so it includes target fields before `orbitId`:

```js
return {
  targetId: marker.targetId || '',
  targetName: marker.targetName || '未命名标定',
  targetMode: marker.targetMode === 'velocity' ? 'velocity' : 'position',
  orbitId: marker.orbitId,
  orbitName: marker.orbitName || '未命名轨道',
  color: marker.color || '#8bbfba',
  positionKm,
  scenePosition: vectorToScene(positionKm),
  residual: Number.isFinite(Number(marker.residual)) ? Number(marker.residual) : 0,
  elapsedSeconds: Number.isFinite(Number(marker.elapsedSeconds)) ? Number(marker.elapsedSeconds) : 0,
};
```

The surrounding filter stays the same:

```js
.filter((marker) => marker?.orbitId && isFiniteVector(marker.positionKm))
```

- [ ] **Step 4: Run scene marker tests to verify GREEN**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\scene-calibration.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit scene marker metadata**

Run:

```powershell
git add js\scene.mjs test\scene-calibration.test.mjs
git commit -m "feat: carry calibration target names into markers"
```

---

### Task 3: Static Multi-Target UI Contract

**Files:**
- Modify: `test/static-files.test.mjs`
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Update the failing static UI contract**

In `test/static-files.test.mjs`, replace the body of `test('vector calibration static UI contract is present', async () => { ... })` with:

```js
test('vector calibration static UI contract is present', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('styles.css', 'utf8');

  assert.equal(await fileExists('js/vector-calibration.mjs'), true, 'vector calibration solver should exist');
  assert.match(html, /<h3>其他功能<\/h3>/, 'workbench should expose an other-functions panel');
  assert.match(html, /位置\/速度标定/, 'calibration tool title should exist');
  assert.match(html, /id="calibration-target-list"/, 'calibration tool should expose a multi-target row list');
  assert.match(html, /id="calibration-add-target"/, 'calibration tool should allow adding named vectors');
  assert.match(html, /id="calibration-submit-all"/, 'calibration tool should run all vector targets');
  assert.match(html, /id="calibration-clear-results"/, 'calibration tool should clear results without deleting rows');
  assert.match(html, /id="calibration-results"/, 'calibration results container should exist');
  assert.match(css, /\.calibration-target-list/, 'calibration target list should be styled');
  assert.match(css, /\.calibration-target-row/, 'calibration target row should be styled');
  assert.match(css, /\.calibration-target-row select/, 'target rows should style per-row mode selectors');
  assert.match(css, /\.calibration-result-group/, 'grouped calibration results should be styled');
});
```

- [ ] **Step 2: Run static tests to verify RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: FAIL on the missing `calibration-target-list`, batch action buttons, and CSS selectors.

- [ ] **Step 3: Add the multi-target HTML shell without breaking current app wiring**

In `index.html`, add this hidden shell inside:

```html
<div class="calibration-tool" aria-label="位置/速度标定">
```

Place it immediately after the existing `.calibration-tool-header` block and before the current `.calibration-mode-control` block:

```html
<div id="calibration-target-list" class="calibration-target-list" aria-label="标定矢量列表" hidden></div>
<div class="calibration-actions calibration-batch-actions" hidden>
  <button id="calibration-add-target" class="secondary-action" type="button">添加矢量</button>
  <button id="calibration-submit-all" class="primary-action" type="button">标定全部</button>
  <button id="calibration-clear-results" class="secondary-action" type="button">清除结果</button>
</div>
```

Keep the existing single-vector controls in place for this commit so `js/app.mjs` still finds `#calibration-x`, `#calibration-submit`, and related elements. Task 4 removes the old controls when the app wiring is ready.

- [ ] **Step 4: Replace calibration CSS for row-based controls**

In `styles.css`, keep `.other-functions-panel`, `.calibration-tool`, `.calibration-tool-header`, and `.calibration-tool-header h4`. Replace `.calibration-tool-header span` and all rules from `.calibration-mode-control` through `.calibration-result-item.is-nearest` with:

```css
.calibration-tool-header span {
  color: var(--subtle);
  font-family: var(--mono);
  font-size: 11px;
}

.calibration-target-list {
  display: grid;
  gap: 8px;
}

.calibration-target-row {
  display: grid;
  grid-template-columns: minmax(72px, 1.1fr) minmax(74px, 0.85fr) repeat(3, minmax(48px, 0.72fr)) 34px;
  gap: 6px;
  align-items: end;
  border: 1px solid rgba(150, 190, 184, 0.14);
  border-radius: 6px;
  padding: 8px;
  background: rgba(5, 14, 20, 0.34);
}

.calibration-target-row label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--muted);
  font-size: 11px;
}

.calibration-target-row input,
.calibration-target-row select {
  width: 100%;
  height: 32px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 7px;
  color: var(--text);
  background: rgba(5, 14, 20, 0.8);
  font-family: var(--mono);
  font-size: 12px;
}

.calibration-target-row input:focus,
.calibration-target-row select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(86, 140, 135, 0.16);
}

.calibration-target-remove {
  width: 34px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  background: rgba(5, 14, 20, 0.58);
  font-size: 18px;
  line-height: 1;
}

.calibration-target-remove:hover {
  color: var(--text);
  border-color: rgba(242, 121, 121, 0.44);
}

.calibration-actions {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
}

.calibration-results {
  display: grid;
  gap: 10px;
  min-height: 42px;
  border: 1px solid rgba(150, 190, 184, 0.16);
  border-radius: 6px;
  padding: 10px;
  color: var(--subtle);
  background: rgba(5, 14, 20, 0.36);
  font-size: 12px;
  line-height: 1.45;
}

.calibration-result-summary {
  color: var(--text);
  font-weight: 700;
}

.calibration-result-group {
  display: grid;
  gap: 8px;
  border-top: 1px solid rgba(148, 176, 190, 0.12);
  padding-top: 9px;
}

.calibration-result-group:first-child {
  border-top: 0;
  padding-top: 0;
}

.calibration-result-group-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.calibration-result-group-header strong {
  color: var(--text);
  font-size: 12px;
}

.calibration-result-group-header span {
  color: var(--subtle);
  font-family: var(--mono);
  font-size: 11px;
}

.calibration-result-item {
  display: grid;
  gap: 5px;
  border-top: 1px solid rgba(148, 176, 190, 0.12);
  padding-top: 8px;
}

.calibration-result-item strong {
  color: var(--text);
  font-size: 12px;
}

.calibration-result-item dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 8px;
  margin: 0;
}

.calibration-result-item dt {
  color: var(--subtle);
}

.calibration-result-item dd {
  margin: 0;
  color: var(--text);
  font-family: var(--mono);
  text-align: right;
  word-break: break-word;
}

.calibration-result-item.is-nearest {
  border-color: rgba(242, 222, 121, 0.28);
}

@media (max-width: 760px) {
  .calibration-target-row {
    grid-template-columns: 1fr 1fr;
  }

  .calibration-actions {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run static tests to verify the static UI contract is GREEN**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit static UI contract and markup**

Run:

```powershell
git add index.html styles.css test\static-files.test.mjs
git commit -m "feat: add multi-vector calibration UI contract"
```

---

### Task 4: App State, Target Rows, Grouped Results, and Batch Markers

**Files:**
- Modify: `index.html`
- Modify: `js/app.mjs`
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Add failing app wiring assertions**

In `test/static-files.test.mjs`, add these assertions at the end of `test('vector calibration static UI contract is present', async () => { ... })`, after the CSS assertions and before the closing `});`:

```js
  const app = await readFile('js/app.mjs', 'utf8');
  const scene = await readFile('js/scene.mjs', 'utf8');

  assert.match(app, /calibrateOrbitVectorTargets/, 'app should import vector calibration batch solver');
  assert.match(app, /calibrationTargets:\s*\[/, 'app should track multiple calibration targets');
  assert.match(app, /renderCalibrationTargets/, 'app should render target rows');
  assert.match(app, /addCalibrationTarget/, 'app should add calibration target rows');
  assert.match(app, /removeCalibrationTarget/, 'app should remove calibration target rows');
  assert.match(app, /calibrationMarkersFromBatchResult/, 'app should flatten batch hits into scene markers');
  assert.match(app, /scene\.setCalibrationMarkers/, 'app should send hits to the 3D scene');
  assert.match(app, /clearVectorCalibration\(\)/, 'orbit lifecycle should clear stale calibration state');
  assert.doesNotMatch(html, /id="calibration-x"/, 'single-vector x input should be replaced by target rows');
  assert.match(scene, /targetName/, 'scene marker normalization should carry target names');
  assert.match(scene, /setCalibrationMarkers/, 'scene should expose calibration marker API');
```

- [ ] **Step 2: Run static tests before app wiring to verify RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: FAIL on app batch wiring assertions such as `calibrateOrbitVectorTargets`, `calibrationTargets`, `renderCalibrationTargets`, `addCalibrationTarget`, `removeCalibrationTarget`, or `calibrationMarkersFromBatchResult`.

- [ ] **Step 3: Replace the solver import**

In `js/app.mjs`, replace:

```js
import { calibrateOrbitVectors } from './vector-calibration.mjs';
```

with:

```js
import { calibrateOrbitVectorTargets } from './vector-calibration.mjs';
```

- [ ] **Step 4: Replace the final calibration HTML controls**

In `index.html`, replace the current contents inside:

```html
<div class="calibration-tool" aria-label="位置/速度标定">
```

with:

```html
<div class="calibration-tool-header">
  <h4>位置/速度标定</h4>
  <span>ECI · km / km/s</span>
</div>
<div id="calibration-target-list" class="calibration-target-list" aria-label="标定矢量列表"></div>
<div class="calibration-actions">
  <button id="calibration-add-target" class="secondary-action" type="button">添加矢量</button>
  <button id="calibration-submit-all" class="primary-action" type="button">标定全部</button>
  <button id="calibration-clear-results" class="secondary-action" type="button">清除结果</button>
</div>
<div id="calibration-results" class="calibration-results" aria-live="polite">添加 ECI 矢量后点击标定全部。</div>
```

Keep the outer `calibration-tool` container and the surrounding `other-functions-panel` unchanged.

- [ ] **Step 5: Replace calibration DOM references**

In the `els` object in `js/app.mjs`, replace:

```js
calibrationModeButtons: Array.from(document.querySelectorAll('[data-calibration-mode]')),
calibrationUnit: document.querySelector('#calibration-unit'),
calibrationX: document.querySelector('#calibration-x'),
calibrationY: document.querySelector('#calibration-y'),
calibrationZ: document.querySelector('#calibration-z'),
calibrationSubmit: document.querySelector('#calibration-submit'),
calibrationClear: document.querySelector('#calibration-clear'),
calibrationResults: document.querySelector('#calibration-results'),
```

with:

```js
calibrationTargetList: document.querySelector('#calibration-target-list'),
calibrationAddTarget: document.querySelector('#calibration-add-target'),
calibrationSubmitAll: document.querySelector('#calibration-submit-all'),
calibrationClearResults: document.querySelector('#calibration-clear-results'),
calibrationResults: document.querySelector('#calibration-results'),
```

- [ ] **Step 6: Add calibration target factory helpers before `const state = {`**

Add this block after the `GroundTrackView` initialization and before `const state = {`:

```js
let calibrationTargetSequence = 1;

function createCalibrationTarget(overrides = {}) {
  const sequence = calibrationTargetSequence;
  calibrationTargetSequence += 1;
  return {
    id: overrides.id ?? `calibration-target-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: overrides.name ?? `标定${sequence}`,
    mode: overrides.mode === 'velocity' ? 'velocity' : 'position',
    vector: {
      x: overrides.vector?.x ?? '',
      y: overrides.vector?.y ?? '',
      z: overrides.vector?.z ?? '',
    },
  };
}
```

- [ ] **Step 7: Replace single-vector calibration state**

In the `state` object, replace:

```js
calibrationMode: 'position',
calibrationVector: { x: '', y: '', z: '' },
calibrationResult: null,
```

with:

```js
calibrationTargets: [createCalibrationTarget()],
calibrationResult: null,
```

- [ ] **Step 8: Replace single-vector calibration helper functions**

In `js/app.mjs`, replace the full block from `function calibrationUnitLabel() {` through `function clearVectorCalibration() { ... }` with:

```js
function calibrationModeLabel(mode = 'position') {
  return mode === 'velocity' ? '速度标定' : '位置标定';
}

function calibrationResidualUnit(mode = 'position') {
  return mode === 'velocity' ? 'km/s' : 'km';
}

function calibrationVectorUnit(mode = 'position') {
  return mode === 'velocity' ? 'km/s' : 'km';
}

function findCalibrationTarget(targetId) {
  return state.calibrationTargets.find((target) => target.id === targetId) ?? null;
}

function updateCalibrationTarget(targetId, field, value) {
  const target = findCalibrationTarget(targetId);
  if (!target) return;
  if (field === 'name') {
    target.name = value;
  } else if (field === 'mode') {
    target.mode = value === 'velocity' ? 'velocity' : 'position';
  } else if (field === 'x' || field === 'y' || field === 'z') {
    target.vector[field] = value;
  }
  state.calibrationResult = null;
  scene.setCalibrationMarkers([]);
  renderCalibrationResults();
}

function addCalibrationTarget() {
  state.calibrationTargets.push(createCalibrationTarget());
  state.calibrationResult = null;
  scene.setCalibrationMarkers([]);
  renderCalibrationTargets();
  renderCalibrationResults();
}

function removeCalibrationTarget(targetId) {
  state.calibrationTargets = state.calibrationTargets.filter((target) => target.id !== targetId);
  if (state.calibrationTargets.length === 0) state.calibrationTargets.push(createCalibrationTarget());
  state.calibrationResult = null;
  scene.setCalibrationMarkers([]);
  renderCalibrationTargets();
  renderCalibrationResults();
}

function renderCalibrationTargets() {
  els.calibrationTargetList.innerHTML = state.calibrationTargets.map((target) => `
    <article class="calibration-target-row" data-calibration-target-id="${escapeHtml(target.id)}">
      <label>
        <span>名称</span>
        <input type="text" value="${escapeHtml(target.name)}" data-calibration-target-field="name" autocomplete="off" />
      </label>
      <label>
        <span>类型</span>
        <select data-calibration-target-field="mode">
          <option value="position"${target.mode === 'position' ? ' selected' : ''}>位置</option>
          <option value="velocity"${target.mode === 'velocity' ? ' selected' : ''}>速度</option>
        </select>
      </label>
      <label>
        <span>x</span>
        <input type="number" step="any" inputmode="decimal" value="${escapeHtml(target.vector.x)}" data-calibration-target-field="x" autocomplete="off" />
      </label>
      <label>
        <span>y</span>
        <input type="number" step="any" inputmode="decimal" value="${escapeHtml(target.vector.y)}" data-calibration-target-field="y" autocomplete="off" />
      </label>
      <label>
        <span>z</span>
        <input type="number" step="any" inputmode="decimal" value="${escapeHtml(target.vector.z)}" data-calibration-target-field="z" autocomplete="off" />
      </label>
      <button class="calibration-target-remove" type="button" data-calibration-remove-target="${escapeHtml(target.id)}" aria-label="删除 ${escapeHtml(target.name)}">×</button>
    </article>
  `).join('');
}

function formatCalibrationVector(vector, digits = 4) {
  if (!vector) return '--';
  return `(${formatNumber(vector.x, digits)}, ${formatNumber(vector.y, digits)}, ${formatNumber(vector.z, digits)})`;
}

function calibrationResultItemHtml(item, mode, nearest = false) {
  return `
    <article class="calibration-result-item${nearest ? ' is-nearest' : ''}">
      <strong>${escapeHtml(nearest ? `最近点：${item.orbitName}` : item.orbitName)}</strong>
      <dl>
        <dt>仿真时刻</dt><dd>${formatNumber(item.elapsedSeconds, 3)} s</dd>
        <dt>ECI 位置</dt><dd>${escapeHtml(formatCalibrationVector(item.positionKm, 3))} km</dd>
        <dt>ECI 速度</dt><dd>${escapeHtml(formatCalibrationVector(item.velocityKmS, 5))} km/s</dd>
        <dt>残差</dt><dd>${formatNumber(item.residual, mode === 'velocity' ? 8 : 5)} ${calibrationResidualUnit(mode)}</dd>
        <dt>动力学</dt><dd>${escapeHtml(item.perturbationModel)}</dd>
      </dl>
    </article>
  `;
}

function calibrationTargetGroupHtml(targetResult) {
  const result = targetResult.result;
  const modeLabel = calibrationModeLabel(targetResult.mode);
  const targetVector = result.targetVector;
  const vectorLabel = targetVector
    ? `${formatCalibrationVector(targetVector, targetResult.mode === 'velocity' ? 6 : 3)} ${calibrationVectorUnit(targetResult.mode)}`
    : '--';

  if (result.status === 'input-error') {
    return `
      <section class="calibration-result-group">
        <div class="calibration-result-group-header">
          <strong>${escapeHtml(targetResult.targetName)}</strong>
          <span>${escapeHtml(modeLabel)}</span>
        </div>
        <div class="empty-list">${escapeHtml(result.error)}</div>
      </section>
    `;
  }

  if (result.status === 'no-visible-orbits') {
    return `
      <section class="calibration-result-group">
        <div class="calibration-result-group-header">
          <strong>${escapeHtml(targetResult.targetName)}</strong>
          <span>${escapeHtml(modeLabel)}</span>
        </div>
        <div class="empty-list">暂无可标定轨道。</div>
      </section>
    `;
  }

  if (result.status === 'no-valid-states') {
    return `
      <section class="calibration-result-group">
        <div class="calibration-result-group-header">
          <strong>${escapeHtml(targetResult.targetName)}</strong>
          <span>${escapeHtml(modeLabel)}</span>
        </div>
        <div class="empty-list">无有效轨道状态。</div>
      </section>
    `;
  }

  if (result.hits.length === 0) {
    return `
      <section class="calibration-result-group">
        <div class="calibration-result-group-header">
          <strong>${escapeHtml(targetResult.targetName)}</strong>
          <span>${escapeHtml(modeLabel)} · ${escapeHtml(vectorLabel)}</span>
        </div>
        <div class="calibration-result-summary">无精确解</div>
        ${result.nearest ? calibrationResultItemHtml(result.nearest, result.mode, true) : ''}
      </section>
    `;
  }

  return `
    <section class="calibration-result-group">
      <div class="calibration-result-group-header">
        <strong>${escapeHtml(targetResult.targetName)}</strong>
        <span>${escapeHtml(modeLabel)} · ${escapeHtml(vectorLabel)}</span>
      </div>
      <div class="calibration-result-summary">命中 ${result.hits.length} 个点</div>
      ${result.hits.map((hit) => calibrationResultItemHtml(hit, result.mode)).join('')}
    </section>
  `;
}

function renderCalibrationResults() {
  const result = state.calibrationResult;
  if (!result) {
    els.calibrationResults.textContent = '添加 ECI 矢量后点击标定全部。';
    return;
  }

  if (result.status === 'no-valid-targets' && result.targets.length === 0) {
    els.calibrationResults.innerHTML = '<div class="empty-list">暂无可标定矢量。</div>';
    return;
  }

  els.calibrationResults.innerHTML = result.targets.map((targetResult) => calibrationTargetGroupHtml(targetResult)).join('');
}

function calibrationMarkersFromBatchResult(result) {
  if (!result?.targets?.length) return [];
  return result.targets.flatMap((targetResult) => (
    targetResult.result.hits.map((hit) => ({
      targetId: targetResult.targetId,
      targetName: targetResult.targetName,
      targetMode: targetResult.mode,
      orbitId: hit.orbitId,
      orbitName: hit.orbitName,
      color: hit.color,
      positionKm: hit.positionKm,
      residual: hit.residual,
      elapsedSeconds: hit.elapsedSeconds,
    }))
  ));
}

function runVectorCalibration() {
  const budget = currentGroundTrackBudget();
  state.calibrationResult = calibrateOrbitVectorTargets(state.orbits, {
    targets: state.calibrationTargets,
    perturbationModel: state.perturbationModel,
    sampleCount: budget.max3dReferenceSamples,
  });
  scene.setCalibrationMarkers(calibrationMarkersFromBatchResult(state.calibrationResult));
  renderCalibrationResults();
}

function clearVectorCalibration() {
  state.calibrationResult = null;
  scene.setCalibrationMarkers([]);
  renderCalibrationResults();
}
```

- [ ] **Step 9: Render target rows in the main UI render**

In `renderUi()`, add `renderCalibrationTargets();` immediately before `renderCalibrationResults();`:

```js
renderMetrics();
renderCalibrationTargets();
renderCalibrationResults();
```

- [ ] **Step 10: Replace calibration event bindings**

In `bindEvents()`, replace:

```js
for (const button of els.calibrationModeButtons) {
  button.addEventListener('click', () => {
    state.calibrationMode = button.dataset.calibrationMode === 'velocity' ? 'velocity' : 'position';
    clearVectorCalibration();
  });
}
els.calibrationSubmit.addEventListener('click', runVectorCalibration);
els.calibrationClear.addEventListener('click', clearVectorCalibration);
```

with:

```js
els.calibrationAddTarget.addEventListener('click', addCalibrationTarget);
els.calibrationSubmitAll.addEventListener('click', runVectorCalibration);
els.calibrationClearResults.addEventListener('click', clearVectorCalibration);
els.calibrationTargetList.addEventListener('input', (event) => {
  const field = event.target?.dataset?.calibrationTargetField;
  const row = event.target?.closest?.('[data-calibration-target-id]');
  if (!field || !row) return;
  updateCalibrationTarget(row.dataset.calibrationTargetId, field, event.target.value);
});
els.calibrationTargetList.addEventListener('change', (event) => {
  const field = event.target?.dataset?.calibrationTargetField;
  const row = event.target?.closest?.('[data-calibration-target-id]');
  if (!field || !row) return;
  updateCalibrationTarget(row.dataset.calibrationTargetId, field, event.target.value);
});
els.calibrationTargetList.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-calibration-remove-target]');
  if (!button) return;
  removeCalibrationTarget(button.dataset.calibrationRemoveTarget);
});
```

- [ ] **Step 11: Run static tests to verify app wiring GREEN**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: PASS.

- [ ] **Step 12: Run syntax check for app wiring**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\app.mjs
```

Expected: exits with code 0.

- [ ] **Step 13: Commit app wiring**

Run:

```powershell
git add index.html js\app.mjs test\static-files.test.mjs
git commit -m "feat: wire multi-vector calibration workflow"
```

---

### Task 5: Full Verification and Browser QA

**Files:**
- Modify only files from Tasks 1-4 if verification exposes a defect.

- [ ] **Step 1: Run full automated tests**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

Expected:

```text
fail 0
```

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\app.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\scene.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\orbit.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\vector-calibration.mjs
```

Expected: each command exits with code 0 and prints no syntax errors.

- [ ] **Step 3: Start or reuse local server**

If no server is running for this worktree, start one:

```powershell
$env:PORT='4181'
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.mjs
```

Expected: app is reachable at `http://127.0.0.1:4181/`.

- [ ] **Step 4: Browser QA target flow**

Use the Browser plugin with the flow:

```text
app loads -> workbench shows multi-vector calibration rows -> add a second row -> run mixed position and velocity targets -> grouped results and markers update -> clear removes results but keeps rows
```

Verify these page facts:

- Page title is `轨道模拟工作台`.
- DOM contains `位置/速度标定`, `添加矢量`, `标定全部`, and `清除结果`.
- Console `error` and `warn` logs are empty or unrelated to the app.
- Add a second target row.
- Set row 1 name to `目标位置A`, mode to `位置`, and fill `x/y/z` from the displayed `ECI 位置`.
- Set row 2 name to `目标速度B`, mode to `速度`, and fill `x/y/z` from the displayed `ECI 速度`.
- Click `标定全部`.
- Result text includes `目标位置A`, `目标速度B`, and two grouped hit summaries.
- Change row 2 vector to `99, 99, 99`, click `标定全部`, and verify row 2 shows `无精确解` while row 1 still reports a hit.
- Change row 2 `x` to `NaN` or clear one vector field, click `标定全部`, and verify row 2 shows an input error while row 1 still reports a hit.
- Click `清除结果` and verify result text returns to `添加 ECI 矢量后点击标定全部。` while both target rows remain visible.
- Capture at least one screenshot showing grouped results after the mixed target hit.

- [ ] **Step 5: Commit verification fixes if needed**

If browser QA exposes a defect, write a failing focused test first when practical, then patch only the affected files. After the fix, run the focused test and the full verification commands again.

Commit any verification fix with:

```powershell
git add js\app.mjs js\scene.mjs js\vector-calibration.mjs index.html styles.css test\static-files.test.mjs test\scene-calibration.test.mjs test\vector-calibration.test.mjs
git commit -m "fix: verify multi-vector calibration workflow"
```

Expected: no commit is created if verification required no code changes.

---

## Self-Review Checklist

- Spec coverage: Tasks 1-4 cover batch targets, per-row mode, per-row naming, grouped results, target marker metadata, single-row error isolation, duplicate names, and preserving rows when clearing results.
- Test-first coverage: Tasks 1-4 each begin with a failing test or failing static contract before production code changes.
- Type consistency: Target objects use `id`, `name`, `mode`, and `vector`; batch results use `targetId`, `targetName`, `mode`, `result`, and flattened `hits`; scene markers use `targetId`, `targetName`, `targetMode`.
- Out of scope preserved: no ECEF input, no simultaneous position+velocity constraint, no export workflow, no configurable tolerance, and no star-subpoint map integration.
