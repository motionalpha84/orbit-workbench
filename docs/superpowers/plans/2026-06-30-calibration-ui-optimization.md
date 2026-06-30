# Calibration UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the multi-vector calibration UI with compact four-line inputs, list-style expandable result series, and per-series marker visibility controls.

**Architecture:** Keep the existing batch solver untouched. Update static contracts first, then adapt `js/app.mjs` state/render/event handling and `styles.css` layout. Marker visibility is filtered in app state before calling `scene.setCalibrationMarkers(...)`.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript ES modules, Node built-in test runner, local `server.mjs`.

---

## File Structure

- Modify `index.html`: change the calibration header caption to `ECI`.
- Modify `styles.css`: replace compact row/table calibration styling with four-line target cards and result-list styles based on orbit list patterns.
- Modify `js/app.mjs`: add expanded/hidden series state, render four-line target inputs with dynamic units, render results as expandable list items, and filter markers by hidden target IDs.
- Modify `js/scene.mjs`: preserve optional marker `visible` metadata.
- Modify `test/static-files.test.mjs`: add static contract checks for the new UI and app wiring.
- Modify `test/scene-calibration.test.mjs`: add marker visibility normalization checks.

---

### Task 1: Static Contract for Optimized Calibration UI

**Files:**
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Add failing static assertions**

Update `test('vector calibration static UI contract is present', ...)` so it also checks:

```js
assert.match(html, /<span class="calibration-frame-label">ECI<\/span>/, 'calibration header should show only ECI');
assert.doesNotMatch(html, /ECI · km \/ km\/s/, 'calibration header should not show units');
assert.match(css, /\.calibration-target-fields/, 'target rows should have a four-line field layout');
assert.match(css, /\.calibration-vector-line/, 'x/y/z rows should be stacked lines');
assert.match(css, /\.calibration-vector-unit/, 'vector units should be styled and right aligned');
assert.match(css, /\.calibration-series-list/, 'calibration results should render as a list');
assert.match(css, /\.calibration-series-item/, 'calibration result series should reuse list item styling');
assert.match(css, /\.calibration-series-detail/, 'expanded calibration details should be styled');
assert.match(app, /calibrationExpandedTargetIds/, 'app should track expanded calibration result series');
assert.match(app, /hiddenCalibrationTargetIds/, 'app should track hidden calibration marker series');
assert.match(app, /toggleCalibrationResultExpansion/, 'app should toggle calibration result details');
assert.match(app, /toggleCalibrationTargetVisibility/, 'app should toggle marker visibility by target');
assert.match(app, /visible:\s*!hiddenCalibrationTargetIds\.has/, 'app should mark hidden target markers invisible');
```

- [ ] **Step 2: Run static tests to verify RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: FAIL on the newly added assertions.

---

### Task 2: Scene Marker Visibility Metadata

**Files:**
- Modify: `test/scene-calibration.test.mjs`
- Modify: `js/scene.mjs`

- [ ] **Step 1: Add failing visibility tests**

Add assertions that `normalizeCalibrationMarkers(...)` defaults `visible` to `true` and preserves `visible: false`.

- [ ] **Step 2: Run scene marker tests to verify RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\scene-calibration.test.mjs
```

Expected: FAIL because visibility is not preserved.

- [ ] **Step 3: Preserve visibility in marker normalization**

Add `visible: marker.visible !== false` to the normalized marker object.

- [ ] **Step 4: Run scene marker tests to verify GREEN**

Run the same scene marker test command. Expected: PASS.

---

### Task 3: App State, Rendering, and Events

**Files:**
- Modify: `index.html`
- Modify: `js/app.mjs`
- Modify: `styles.css`

- [ ] **Step 1: Update header HTML**

Change the calibration header caption from `ECI · km / km/s` to:

```html
<span class="calibration-frame-label">ECI</span>
```

- [ ] **Step 2: Add result state**

Add these sets to `state`:

```js
calibrationExpandedTargetIds: new Set(),
hiddenCalibrationTargetIds: new Set(),
```

- [ ] **Step 3: Render four-line target rows**

Update `renderCalibrationTargets()` to emit:

```html
<article class="calibration-target-row" data-calibration-target-id="...">
  <div class="calibration-target-fields">
    <div class="calibration-target-topline">...</div>
    <label class="calibration-vector-line">...</label>
    <label class="calibration-vector-line">...</label>
    <label class="calibration-vector-line">...</label>
  </div>
  <button class="calibration-target-remove" ...>×</button>
</article>
```

Each vector line includes `<span class="calibration-vector-unit">km</span>` or `km/s` from `calibrationVectorUnit(target.mode)`.

- [ ] **Step 4: Render result series list**

Replace grouped result markup with list item markup:

```html
<div class="calibration-series-list">
  <article class="calibration-series-item" data-calibration-result-target="...">
    <span class="color-dot"></span>
    <button class="calibration-series-main" type="button" data-calibration-toggle-result="...">...</button>
    <div class="calibration-series-actions">
      <button class="mini-button" type="button" data-calibration-target-visibility="...">●</button>
    </div>
    <div class="calibration-series-detail">...</div>
  </article>
</div>
```

- [ ] **Step 5: Filter markers by hidden series**

Update `calibrationMarkersFromBatchResult(result)` so each marker includes:

```js
visible: !state.hiddenCalibrationTargetIds.has(targetResult.targetId),
```

and filters hidden targets out before sending markers to the scene.

- [ ] **Step 6: Add event handlers**

Add delegated click handling in `bindEvents()` for `data-calibration-toggle-result` and `data-calibration-target-visibility`.

- [ ] **Step 7: Update CSS**

Add styles for four-line input rows, right-aligned units, list-style calibration series, expanded details, selected/hidden states, and mobile stacking.

- [ ] **Step 8: Run static tests to verify GREEN**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: PASS.

---

### Task 4: Full Verification

**Files:**
- Modify only files above if verification exposes a defect.

- [ ] **Step 1: Run full tests**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

Expected: `fail 0`.

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\app.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\scene.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\orbit.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\vector-calibration.mjs
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify served HTML contract**

Fetch `http://127.0.0.1:4181/` and verify the optimized header and result containers are present.

- [ ] **Step 4: Commit**

Commit docs, tests, and implementation with:

```powershell
git add docs\superpowers\specs\2026-06-30-calibration-ui-optimization-design.md docs\superpowers\plans\2026-06-30-calibration-ui-optimization.md index.html styles.css js\app.mjs js\scene.mjs test\static-files.test.mjs test\scene-calibration.test.mjs
git commit -m "feat: optimize calibration result controls"
```

---

## Self-Review

- Spec coverage: Tasks cover title caption, four-line input layout, dynamic units, expandable result list, and per-series marker visibility.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Target IDs remain `targetId`; app state uses `calibrationExpandedTargetIds` and `hiddenCalibrationTargetIds`; marker visibility uses `visible`.
