# Ground Track Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom expandable 2D ground-track map panel that follows current orbit propagation, supports filtering, time windows, map interactions, performance presets, CSV export, and screenshot integration.

**Architecture:** Keep orbital math in pure modules and keep canvas map rendering separate from app state wiring. `js/groundtrack.mjs` owns ECI/ECEF/geodetic conversion, time windows, sampling, dateline splitting, region statistics, CSV, and performance budgets. `js/groundtrack-view.mjs` owns the 2D canvas map renderer and pointer interactions. `js/app.mjs`, `index.html`, and `styles.css` integrate the feature with the existing workbench and bottom controls.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript ES modules, Three.js for the existing 3D scene, Node built-in test runner.

---

### Task 1: Pure Ground-Track Math

**Files:**
- Create: `js/groundtrack.mjs`
- Create: `test/groundtrack.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests for sidereal time from UTC, ECI to ECEF conversion, ECEF to lon/lat, dateline splitting, time-window sampling, CSV generation, and performance budgets.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test\groundtrack.test.mjs`
Expected: fail because `js/groundtrack.mjs` does not exist.

- [ ] **Step 3: Implement pure module**

Create functions:

- `normalizeLongitudeDeg`
- `utcMsFromInput`
- `greenwichSiderealAngleAt`
- `eciToEcef`
- `ecefToLonLat`
- `groundTrackPoint`
- `resolveGroundTrackWindow`
- `sampleGroundTrack`
- `splitDatelineSegments`
- `groundTrackCsv`
- `groundTrackRegionStats`
- `groundTrackBudget`

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test\groundtrack.test.mjs`
Expected: all tests pass.

### Task 2: Static UI Contract

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `test/static-files.test.mjs`
- Add: `assets/maps/dark-world-map.svg`

- [ ] **Step 1: Write failing static tests**

Add checks for the ground-track panel, canvas, controls, filter list, stats surfaces, UTC start input, performance controls, map asset, and app wiring identifiers.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test\static-files.test.mjs`
Expected: fail because the UI and asset are not present.

- [ ] **Step 3: Add HTML/CSS and map asset**

Add a bottom panel with ids `ground-track-panel`, `ground-track-canvas`, `ground-track-toggle`, `ground-track-fullscreen`, `ground-track-close`, `ground-track-filter-list`, `ground-track-stats`, `ground-track-csv`, `ground-track-reset-view`, and time-window/performance inputs. Add a local dark world map SVG at `assets/maps/dark-world-map.svg`.

- [ ] **Step 4: Run static tests and verify GREEN**

Run: `node --test test\static-files.test.mjs`
Expected: static tests pass.

### Task 3: Canvas Map Renderer

**Files:**
- Create: `js/groundtrack-view.mjs`
- Create: `test/groundtrack-view.test.mjs`

- [ ] **Step 1: Write failing renderer tests**

Test lon/lat projection, inverse projection, viewport zoom/pan clamp behavior, rectangle region conversion, and hidden-panel rendering guard.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test\groundtrack-view.test.mjs`
Expected: fail because the renderer module does not exist.

- [ ] **Step 3: Implement renderer module**

Create `GroundTrackView` plus pure helpers `lonLatToMapPoint`, `mapPointToLonLat`, `normalizeMapViewport`, and `selectionToLonLatBounds`. The class draws the local map image, grid, history lines, future dashed lines, current markers, particles, hover tooltip data, selection overlay, and region stats hooks.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run: `node --test test\groundtrack-view.test.mjs`
Expected: renderer tests pass.

### Task 4: App State Integration

**Files:**
- Modify: `js/app.mjs`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `test/static-files.test.mjs`

- [ ] **Step 1: Write failing integration tests**

Extend static tests to require imports from `groundtrack.mjs` and `groundtrack-view.mjs`, state fields for UTC start time, map panel mode, map filters, window mode/value, and performance mode. Require calls to sample tracks, render the map, export CSV, and include map screenshot handling.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test\static-files.test.mjs`
Expected: fail on missing integration.

- [ ] **Step 3: Wire app state and events**

Add state for `simulationStartUtc`, `groundTrackPanel`, `groundTrackFilters`, `groundTrackWindow`, `performance`. Render filters from visible orbits, sample tracks using current perturbation model, update the canvas on playback ticks, toggle panel/fullscreen/close, export CSV, reset map view, update region stats, and refresh after orbit or model changes.

- [ ] **Step 4: Run integration tests and verify GREEN**

Run: `node --test test\static-files.test.mjs`
Expected: static integration tests pass.

### Task 5: Full Verification and Browser QA

**Files:**
- No source changes expected unless verification finds a bug.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\app.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\scene.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\orbit.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\groundtrack.mjs
& 'C:\Users\刘宗哲\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\groundtrack-view.mjs
```

- [ ] **Step 2: Run rendered QA**

Start `server.mjs` on a temporary localhost port, open the page, verify the app loads, the map opens, fullscreen toggles, filters render, no console errors appear, and a screenshot shows the panel.

- [ ] **Step 3: Stop local server**

Stop the temporary server process before final response.

