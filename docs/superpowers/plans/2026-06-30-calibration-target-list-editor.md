# Calibration Target List Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change vector calibration from direct multi-row editing to a single input editor plus an added-target list with show, edit, and delete actions.

**Architecture:** Keep the batch solver unchanged. Split app state into `calibrationDraftTarget` for the editor and `calibrationTargets` for committed list items. Reuse the existing result expansion and marker visibility state, but update rendering and events so list items behave like orbit list rows.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript ES modules, Node built-in test runner, Codex in-app browser for rendered QA.

---

## File Structure

- Modify `test/static-files.test.mjs`: add static contract coverage for the editor/list split and no color-dot in calibration list rendering.
- Modify `index.html`: add editor container, editor error, list label, and cancel-edit button.
- Modify `js/app.mjs`: add draft/editing state, editor rendering, add/save/edit/delete handlers, target list rendering without color dots, and marker refresh.
- Modify `styles.css`: style editor, list heading, list rows, editor error, and action buttons.

---

### Task 1: Static Contract

**Files:**
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Write failing assertions**

Add assertions for:

```js
assert.match(html, /id="calibration-target-editor"/, 'calibration tool should have a single target editor');
assert.match(html, /id="calibration-editor-error"/, 'calibration editor should expose validation errors');
assert.match(html, /添加至标定列表/, 'calibration primary button should add the draft target to the list');
assert.match(html, /id="calibration-cancel-edit"/, 'calibration editor should allow cancelling edits');
assert.match(html, /标定点列表/, 'calibration target list should have a list label');
assert.match(app, /calibrationDraftTarget/, 'app should keep a separate calibration draft target');
assert.match(app, /calibrationEditingTargetId/, 'app should track which target is being edited');
assert.match(app, /addOrSaveCalibrationTarget/, 'app should add or save a draft calibration target');
assert.match(app, /editCalibrationTarget/, 'app should edit calibration targets from the list');
assert.match(app, /deleteCalibrationTarget/, 'app should delete calibration targets from the list');
assert.doesNotMatch(app, /calibrationSeriesItemHtml[\s\S]*color-dot/, 'calibration list items should not render color dots');
```

- [ ] **Step 2: Run RED**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test\static-files.test.mjs
```

Expected: FAIL on the new editor/list assertions.

---

### Task 2: App and UI Refactor

**Files:**
- Modify: `index.html`
- Modify: `js/app.mjs`
- Modify: `styles.css`

- [ ] **Step 1: Update HTML shell**

Add `#calibration-target-editor`, `#calibration-editor-error`, `#calibration-cancel-edit`, and a list label for `标定点列表`.

- [ ] **Step 2: Add draft state**

Add:

```js
calibrationDraftTarget: createCalibrationDraftTarget(),
calibrationEditingTargetId: null,
calibrationEditorError: '',
calibrationTargets: [],
```

- [ ] **Step 3: Render editor**

Create `renderCalibrationEditor()` and call it from `renderUi()`.

- [ ] **Step 4: Render committed target list**

Update `renderCalibrationTargets()` to render only committed targets as list items with show, edit, and delete buttons. Remove color-dot markup.

- [ ] **Step 5: Add editor handlers**

Add `updateCalibrationDraftTarget`, `addOrSaveCalibrationTarget`, `editCalibrationTarget`, `deleteCalibrationTarget`, and `cancelCalibrationTargetEdit`.

- [ ] **Step 6: Update events**

Move input/change handling to `#calibration-target-editor`. Use delegated target-list clicks for show, edit, delete, and expand.

- [ ] **Step 7: Run GREEN**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test test/static-files.test.mjs
```

Expected: PASS.

---

### Task 3: Verification

**Files:**
- Modify only files above if verification exposes defects.

- [ ] **Step 1: Full tests**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

Expected: `fail 0`.

- [ ] **Step 2: Syntax checks**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\app.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\scene.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\orbit.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\vector-calibration.mjs
```

Expected: all exit 0.

- [ ] **Step 3: Browser QA**

Verify in `http://127.0.0.1:4181/`:

- Add a position target from the editor.
- Add a velocity target from the editor.
- Run calibration and expand a result.
- Hide/show one target's markers.
- Edit a target and save.
- Delete a target.
- Confirm console has no app errors.

- [ ] **Step 4: Commit**

Commit with:

```powershell
git add docs\superpowers\specs\2026-06-30-calibration-target-list-editor-design.md docs\superpowers\plans\2026-06-30-calibration-target-list-editor.md index.html js\app.mjs styles.css test\static-files.test.mjs
git commit -m "feat: add calibration target list editor"
```

---

## Self-Review

- Spec coverage: The plan covers editor/list split, add/save/cancel, show/edit/delete list actions, and no color-dot list marker.
- Placeholder scan: No placeholders remain.
- Type consistency: Draft state and committed target list use the same `name`, `mode`, and `vector` shape.
