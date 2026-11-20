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

test('static app entrypoint uses local offline assets and required modules', async () => {
  assert.equal(await fileExists('index.html'), true, 'index.html should exist');
  assert.equal(await fileExists('styles.css'), true, 'styles.css should exist');
  assert.equal(await fileExists('js/i18n.mjs'), true, 'EN / 简中 runtime should exist');
  assert.equal(await fileExists('js/orbit-class.mjs'), true, 'orbit classification module should exist');
  assert.equal(await fileExists('assets/maps/firefly-world-map.svg'), true, 'light Firefly map should be local');
  for (const font of ['chakra-petch-500', 'chakra-petch-600', 'chakra-petch-700', 'jetbrains-mono-var']) {
    assert.equal(await fileExists(`assets/fonts/${font}.woff2`), true, `${font} should be vendored locally`);
  }
  assert.equal(await fileExists('js/app.mjs'), true, 'app module should exist');
  assert.equal(await fileExists('js/scene.mjs'), true, 'scene module should exist');
  assert.equal(await fileExists('js/groundtrack.mjs'), true, 'ground-track math module should exist');
  assert.equal(await fileExists('js/groundtrack-history.mjs'), true, 'ground-track history module should exist');
  assert.equal(await fileExists('js/groundtrack-view.mjs'), true, 'ground-track map renderer should exist');
  assert.equal(await fileExists('vendor/three.module.js'), true, 'Three.js should be vendored locally');
  assert.equal(await fileExists('assets/textures/earth_blue_marble_topo_5400.jpg'), true, 'earth texture should be local');
  assert.equal(await fileExists('assets/maps/dark-world-map.svg'), true, 'offline dark world map should be local');

  const html = await readFile('index.html', 'utf8');
  const appSource = await readFile('js/app.mjs', 'utf8');
  assert.match(appSource, /import\('\.\/scene\.mjs'\)/, 'the vendored Three.js scene stays available as the ?renderer=webgl fallback');
  assert.match(appSource, /new SchematicScene\(els\.canvas\)/, 'the Firefly schematic renders the workbench stage');
  assert.match(appSource, /new SchematicScene\(els\.miniCanvas, \{ mini: true, source: scene \}\)/, 'the ground-track viewport shares the schematic data');
  assert.equal(await fileExists('assets/maps/earth-land-mask-4096.png'), true, 'the globe should use the local Natural Earth land mask');
  for (const id of ['scene-plotter', 'scene-scale-bar', 'mini-canvas', 'ground-track-readout', 'worker-slots', 'queue-running', 'queue-completed', 'queue-failed']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.match(html, /assets\/favicon\.svg/, 'index should use a local favicon');
  assert.match(html, /href="\.\/styles\.css"/, 'entrypoint should load the Firefly stylesheet');
  assert.doesNotMatch(html, /styles-v21\.css/, 'the v2.1 style layer is retired in v2.2');
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/, 'fonts must load from local assets so the app works offline');
  for (const [label, code, name] of [['半长轴', 'SMA', 'semiMajorAxisKm'], ['偏心率', 'ECC', 'eccentricity'], ['轨道倾角', 'INC', 'inclinationDeg'], ['升交点赤经', 'RAAN', 'raanDeg'], ['近地点幅角', 'AOP', 'argPeriapsisDeg'], ['真近点角', 'TA', 'trueAnomalyDeg']]) {
    assert.ok(html.includes(`${label} <i>${code}</i>`), `six-element cell should show ${label} ${code}`);
    assert.match(html, new RegExp(`name="${name}"[^>]*placeholder="-"`), `${name} should show "-" when empty`);
  }
});

test('modular console keeps navigation and accessible scene controls', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('styles.css', 'utf8');
  const app = await readFile('js/app.mjs', 'utf8');

  for (const moduleName of ['workbench', 'groundTrack', 'console', 'assets', 'calibration', 'settings', 'info']) {
    assert.match(html, new RegExp(`data-module-nav="${moduleName}"`), `${moduleName} nav button should exist`);
  }
  assert.match(html, /module-sidebar/, 'module sidebar should exist');
  // V2.2: Workbench / Ground Track / Queue are persistent views; assets / calibration / settings are drawers
  for (const view of ['workbench', 'groundTrack', 'console']) {
    assert.match(html, new RegExp(`data-view="${view}"`), `${view} should be a persistent view`);
  }
  for (const drawer of ['assets', 'calibration', 'settings']) {
    assert.match(html, new RegExp(`data-module-panel="${drawer}"`), `${drawer} should be a drawer`);
    assert.match(html, new RegExp(`data-module-pin="${drawer}"`), `${drawer} drawer should have a pin button`);
  }
  assert.match(html, /id="info-modal"/, 'help should open as a modal');
  assert.match(html, /id="console-panel"/, 'console should be reachable as the queue view');
  assert.match(html, /class="ic pin-icon"/, 'pin buttons should use the pin icon');
  assert.match(html, /id="backend-status"[^>]*class="conn connection-badge"/, 'top bar should show the compute link status');
  assert.match(html, /data-lang-set="en"[\s\S]*data-lang-set="zh"/, 'top bar should expose the EN / 简中 switch');
  assert.doesNotMatch(html, /id="ground-track-toggle"/, 'bottom ground-track button should be removed');
  assert.doesNotMatch(html, /workbench-hover-zone/, 'old hover strip should be removed');

  assert.match(css, /module-sidebar/, 'CSS should style the module sidebar');
  assert.match(css, /side-module-panel/, 'CSS should style side module panels');
  assert.match(css, /\.drawer\.is-open/, 'drawers should slide in when open');
  assert.match(css, /\.simulation-time-panel\s*\{[^}]*cursor:\s*pointer/, 'simulation time readout should remain interactive');
  assert.match(css, /:focus-visible/, 'keyboard users should have visible focus');
  assert.match(css, /prefers-reduced-motion/, 'motion should respect the system preference');
  assert.match(css, /\.module-nav-icon path,\s*\.module-nav-icon circle,\s*\.module-nav-icon ellipse\s*\{[\s\S]*?fill:\s*none[\s\S]*?stroke:\s*currentColor/, 'module nav icons should style path, circle and ellipse strokes consistently');
  assert.doesNotMatch(css, /border-radius:\s*16px/, 'no generic rounded SaaS cards');
  assert.doesNotMatch(css, /transition:[^;]*\blinear\b/, 'no linear transitions');

  assert.match(app, /VIEW_MODULES/, 'app should switch between persistent views');
  assert.match(app, /function setActiveView/, 'views should switch through one entry point');
  assert.match(await readFile('js/ui-shell.mjs', 'utf8'), /VIEW_MS = 1500/, 'view switching should take 1.5 s');
  assert.match(app, /modulePins/, 'app should remember module pin state');
  assert.match(app, /startModulePreview/, 'app should support delayed hover preview');
  assert.match(app, /setTimeout\(\(\) => \{[\s\S]*2000\)/, 'preview delay should be two seconds');
  assert.match(app, /toggleModuleFromSidebar/, 'sidebar clicks should toggle modules');
  assert.match(app, /closeActiveModule/, 'outside clicks should close unpinned modules');
});

test('workbench, assets, settings, and ground-track controls match the new contract', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('styles.css', 'utf8');
  const app = await readFile('js/app.mjs', 'utf8');
  const view = await readFile('js/groundtrack-view.mjs', 'utf8');

  assert.match(html, /id="simulation-start-utc" type="datetime-local"/, 'workbench should retain the UTC simulation time input');
  assert.match(html, /id="speed-factor"[\s\S]*value="86400">86400X \(1day\/s\)/, 'speed factor should include a one-day-per-second option');
  assert.match(html, /role="toolbar" aria-label="视图与图层"/, 'scene controls should live in the VIEW / LAYER toolbar');
  assert.match(html, /id="reset-view"[^\n]*\n\s*<button id="plane-view-toggle"[^>]*aria-controls="plane-view-pop"/, 'the orbit-plane view button should close the VIEW group');
  assert.match(html, /id="plane-view-pop" role="dialog"[\s\S]*id="plane-view-inc"[\s\S]*id="plane-view-raan"/, 'the plane view popover should take inclination and RAAN');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(html.includes(`<span class="v" data-i18n-skip>v${version}</span>`), 'the top bar should show the release version');
  assert.doesNotMatch(html, /v2\.2|VER \/\/ 2\.2/, 'no stale 2.2 version labels remain');
  assert.match(html, /导入工作环境 JSON[\s\S]*id="import-data-toggle"[\s\S]*id="import-txt"[\s\S]*id="import-group-txt"[\s\S]*id="import-trajectory-txt"/, 'assets import splits workspace JSON from the three orbit / trajectory TXT kinds');
  assert.match(html, /id="import-dialog"[\s\S]*name="import-body" value="earth"[\s\S]*name="import-frame" value="ECI"[\s\S]*name="import-frame" value="ECEF"/, 'the import window asks for a central body or a frame');
  assert.match(html, /id="model-menu"[^>]*>[\s\S]*?data-model-fly="body"[\s\S]*?data-model-fly="model"[\s\S]*?<\/div>\s*<div class="dd-fly" id="body-flyout"[\s\S]*?id="dynamics-flyout"/, 'MODEL shows the current body and model with side flyouts to choose');
  for (const id of ['hf-workspace', 'hf-elements', 'hf-group', 'hf-trajectory']) assert.match(html, new RegExp(`id="${id}" role="tabpanel"`), `help shows the ${id} import format`);
  assert.doesNotMatch(html, /id="toggle-graticule"/, 'the earth graticule is always visible in v2.2');
  assert.match(app, /graticule: true/, 'restored scenes should keep the graticule on');
  for (const id of ['toggle-axes', 'toggle-ecliptic', 'toggle-radius', 'toggle-reference']) {
    assert.match(html, new RegExp(`id="${id}" type="checkbox"`), `${id} layer toggle should exist`);
  }
  assert.match(html, /坐标轴/, 'axes toggle should exist');
  assert.match(html, /黄道面/, 'ecliptic toggle should exist');
  assert.match(html, /赤道面/, 'equator reference toggle should exist');
  assert.match(html, /完整轨道淡参考/, 'reference orbit toggle should exist');

  assert.match(html, /id="asset-group-name"/, 'assets should name orbit groups');
  assert.match(html, /id="asset-save-group"/, 'assets should save orbit groups');
  assert.match(html, /id="asset-rename-group"/, 'assets should rename orbit groups');
  assert.match(html, /id="asset-group-list"/, 'assets should list saved orbit groups');
  assert.match(html, /id="export-json"/, 'assets should export JSON');
  assert.match(html, /id="import-json"/, 'assets should import JSON');
  assert.match(html, /id="import-txt"/, 'assets should import TXT');
  const screenshotButtonIndex = html.indexOf('id="screenshot-button"');
  assert.ok(screenshotButtonIndex > html.indexOf('id="assets-panel"'), 'scene screenshot export should live in the assets panel');
  assert.ok(screenshotButtonIndex < html.indexOf('id="settings-panel"'), 'scene screenshot export should stay inside the assets panel');
  assert.ok(screenshotButtonIndex > html.indexOf('id="import-txt"'), 'scene screenshot export should be grouped with asset import/export actions');
  assert.match(html, /id="export-ground-track-png"/, 'assets should export ground-track PNG');
  assert.doesNotMatch(html, /class="bottom-control-row action-control-row"[\s\S]*id="screenshot-button"[\s\S]*<aside id="ground-track-panel"/, 'scene screenshot export should be removed from the bottom simulation controls');

  assert.match(html, /id="ground-track-performance-mode"[\s\S]*value="high" selected/, 'settings should default to high performance');
  assert.match(html, /id="export-name-prefix"/, 'settings should hold export filename prefix');
  assert.match(html, /id="clear-all"/, 'settings should clear the current scene');
  assert.match(html, /id="exit-page"/, 'settings should expose exit');

  assert.match(html, /id="ground-track-filter-list"[^>]*aria-label="星下点轨迹选择"/, 'ground-track filters should sit in the map toolbar');
  assert.match(html, /id="ground-track-window-mode"/, 'ground-track window mode should exist');
  assert.match(html, /class="cmod" id="ground-track-stats-panel"[\s\S]*区域统计/, 'region stats should use the MOD.06 module');
  assert.match(html, /id="track-canvas-slot"/, 'ground-track view should host the 3D viewport');
  assert.match(html, /id="ground-track-minimize"/, 'ground-track panel should support minimize');
  assert.match(html, /id="ground-track-mode-toggle"/, 'window and fullscreen should be combined into one control');
  assert.match(html, /id="ground-track-highlight-longitude"/, 'longitude highlight toggle should exist');
  assert.match(html, /id="ground-track-highlight-latitude"/, 'latitude highlight toggle should exist');
  assert.match(html, /id="ground-track-highlight-equator"/, 'equator highlight toggle should exist');
  assert.match(html, /id="ground-track-cursor-guides"/, 'cursor guide toggle should exist');
  assert.match(html, /value="day"/, 'time unit selector should include day');
  assert.match(html, /id="ground-track-csv"/, 'sampled trajectory CSV export should be available in assets');
  assert.match(html, /id="pause-button"[\s\S]*<path d="M9 6v12"><\/path>[\s\S]*<path d="M15 6v12"><\/path>/, 'pause icon bars should be separate strokes');
  assert.doesNotMatch(html, /M8 5h3v14H8z/, 'pause icon should not use touching filled bars');
  assert.match(html, /id="reset-time"[\s\S]*class="button-icon reset-icon"[\s\S]*class="reset-icon-arc" d="M6\.1 17\.3A8\.2 8\.2 0 1 0 7\.2 5\.6"[\s\S]*class="reset-icon-head" d="M4\.4 2\.8 2\.3 13\.7 12\.5 10\.8z"/, 'reset icon should use a large counterclockwise arrow matching the reference image');
  assert.match(css, /\.icon-control-button \.button-icon path[^}]*stroke-linecap:\s*round/, 'pause and icon controls should use stroked separated bars');
  assert.match(css, /#reset-time \.reset-icon-head\s*\{[\s\S]*?fill:\s*currentColor/, 'reset icon should use a filled arrow head like the reference image');
  assert.match(css, /\.ground-track-panel\.is-fullscreen\s*\{[^}]*height:\s*auto/, 'fullscreen map should fill the available viewport');

  assert.match(app, /ASSET_LIBRARY_KEY/, 'app should persist asset groups locally');
  assert.match(app, /serializeWorkbenchSnapshot/, 'asset groups should save full workbench snapshots');
  assert.match(app, /saveCurrentAssetGroup/, 'app should save current orbit groups');
  assert.match(app, /deleteAssetGroup/, 'app should delete orbit groups with confirmation');
  assert.match(app, /formatUtc\(group\.updatedAt/, 'assets should display saved UTC timestamps with the app UTC formatter');
  assert.match(app, /formatUtc\(item\.earliestUtcMs/, 'ground-track stats should display UTC timestamps with the app UTC formatter');
  assert.match(app, /TIME_READOUT_UNITS/, 'simulation time readout should track a unit cycle');
  assert.match(app, /formatSimulationTimeReadout/, 'simulation time readout should format the active time unit');
  assert.match(app, /cycleSimulationTimeUnit/, 'simulation time readout should cycle units on double-click');
  assert.match(app, /timeReadoutPanel[\s\S]*addEventListener\('dblclick',\s*cycleSimulationTimeUnit\)/, 'simulation time readout panel should bind double-click unit cycling');
  assert.match(app, /formatNumber\(current\.velocityKmS\[axis\], 6\)/, 'ECI velocity output should expose enough precision for vector calibration copy/paste');
  for (const id of ['state-px', 'state-py', 'state-pz', 'state-vx', 'state-vy', 'state-vz', 'selected-orbit-period', 'selected-orbit-periapsis', 'selected-orbit-apoapsis', 'selected-orbit-speed']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should be shown in the HUD`);
  }
  assert.match(app, /classifyOrbitRecord/, 'roster and HUD should show the orbit class badge');
  assert.match(app, /function toggleOrbitEdit/, 'the pencil should toggle edit mode');
  assert.match(app, /\/\/\/ REVISED/, 'the orbit being edited should be tagged REVISED');
  assert.match(app, /selectedIds:\s*\[\]/, 'app should track multiple selected orbit ids');
  assert.match(app, /function isOrbitSelected/, 'app should expose a shared selected-orbit predicate');
  assert.match(app, /function toggleOrbitSelection/, 'orbit clicks should toggle selection instead of replacing it');
  assert.match(app, /status-orbit-choice\$\{isOrbitSelected\(record\.id\)/, 'status orbit menu should highlight every selected orbit');
  assert.match(app, /scene\.setSelectedOrbits\(state\.selectedIds\)/, '3D scene should receive all selected orbit ids');
  assert.match(app, /exportGroundTrackPng/, 'app should export a PNG ground-track image');
  assert.match(app, /capturePng\(\{ width: 1920, height: 1080 \}\)/, 'ground-track PNG export should use fixed 1920x1080 size');
  assert.match(app, /shouldConfirmGroundTrackClose/, 'ground-track close should confirm while running with selected tracks');
  assert.match(app, /groundTrackPanel === 'closed'/, 'closed ground-track panel should stop background history syncing');
  assert.match(app, /groundTrackPanel === 'minimized'/, 'minimized ground-track panel should be tracked separately');
  assert.match(app, /state\.groundTrackFilters\[id\] = false/, 'new ground-track filters should default off');

  assert.match(view, /captureFixedSizePng/, 'renderer should support fixed-size PNG export');
  assert.match(view, /selectedIds/, 'ground-track renderer should support multiple selected tracks');
  assert.match(view, /drawCursorGuides/, 'renderer should support cursor latitude and longitude guides');
  assert.match(view, /highlightLongitude/, 'renderer should support longitude highlighting');
  assert.match(view, /highlightLatitude/, 'renderer should support latitude highlighting');
  assert.match(view, /highlightEquator/, 'renderer should support equator highlighting');
});

test('vector calibration static UI contract is present', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('styles.css', 'utf8');
  const app = await readFile('js/app.mjs', 'utf8');
  const scene = await readFile('js/scene.mjs', 'utf8');

  assert.equal(await fileExists('js/vector-calibration.mjs'), true, 'vector calibration solver should exist');
  assert.match(html, /id="calibration-panel"[^>]*data-module-panel="calibration"/, 'calibration should open as a drawer');
  assert.match(html, /位置矢量\/速度矢量标定/, 'calibration tool title should include vector wording');
  assert.doesNotMatch(html, /位置\/速度标定/, 'calibration tool title should not use the shorter wording');
  assert.match(html, /id="calibration-target-list"/, 'calibration tool should expose a multi-target row list');
  assert.match(html, /id="calibration-add-target"/, 'calibration tool should allow adding named vectors');
  assert.match(html, /id="calibration-submit-all"/, 'calibration tool should run all vector targets');
  assert.match(html, /id="calibration-clear-results"/, 'calibration tool should clear results without deleting rows');
  assert.match(html, /id="calibration-results"/, 'calibration results container should exist');
  assert.match(html, /id="calibration-target-editor"/, 'calibration tool should have a single target editor');
  assert.match(html, /id="calibration-editor-error"/, 'calibration editor should expose validation errors');
  assert.match(html, /添加至标定列表/, 'calibration primary button should add the draft target to the list');
  assert.match(html, /id="calibration-cancel-edit"/, 'calibration editor should allow cancelling edits');
  assert.match(html, /标定点列表/, 'calibration target list should have a list label');
  assert.match(html, /<span class="calibration-frame-label">ECI<\/span>/, 'calibration header should show only ECI');
  assert.doesNotMatch(html, /ECI · km \/ km\/s/, 'calibration header should not show units');
  assert.match(css, /\.calibration-target-list/, 'calibration target list should be styled');
  assert.match(css, /\.calibration-target-row/, 'calibration target row should be styled');
  assert.match(css, /\.calibration-target-row select/, 'target rows should style per-row mode selectors');
  assert.match(css, /\.calibration-target-fields/, 'target rows should have a four-line field layout');
  assert.match(css, /\.calibration-vector-line/, 'x/y/z rows should be stacked lines');
  assert.match(css, /\.calibration-vector-unit/, 'vector units should be styled and right aligned');
  assert.match(css, /\.calibration-series-list/, 'calibration results should render as a list');
  assert.match(css, /\.calibration-series-item/, 'calibration result series should reuse list item styling');
  assert.match(css, /\.calibration-series-detail/, 'expanded calibration details should be styled');
  assert.match(app, /backend\.run\('calibration'/, 'vector calibration should be submitted to the backend');
  assert.match(app, /calibrationTargets:\s*\[\]/, 'app should track committed calibration targets separately');
  assert.match(app, /calibrationDraftTarget/, 'app should keep a separate calibration draft target');
  assert.match(app, /calibrationEditingTargetId/, 'app should track which target is being edited');
  assert.match(app, /calibrationExpandedTargetIds/, 'app should track expanded calibration result series');
  assert.match(app, /hiddenCalibrationTargetIds/, 'app should track hidden calibration marker series');
  assert.match(app, /renderCalibrationEditor/, 'app should render a single draft editor');
  assert.match(app, /renderCalibrationTargets/, 'app should render target rows');
  assert.match(app, />位置矢量<\/option>/, 'position mode option should use vector wording');
  assert.match(app, />速度矢量<\/option>/, 'velocity mode option should use vector wording');
  assert.match(app, /velocity'\s*\?\s*'速度矢量标定'\s*:\s*'位置矢量标定'/, 'calibration mode labels should use vector wording');
  assert.match(app, /addCalibrationTarget/, 'app should add calibration target rows');
  assert.match(app, /addOrSaveCalibrationTarget/, 'app should add or save a draft calibration target');
  assert.match(app, /editCalibrationTarget/, 'app should edit calibration targets from the list');
  assert.match(app, /deleteCalibrationTarget/, 'app should delete calibration targets from the list');
  assert.match(app, /toggleCalibrationResultExpansion/, 'app should toggle calibration result details');
  assert.match(app, /toggleCalibrationTargetVisibility/, 'app should toggle marker visibility by target');
  assert.match(app, /visible:\s*!state\.hiddenCalibrationTargetIds\.has/, 'app should mark hidden target markers invisible');
  const calibrationSeriesItemSource = app.match(/function calibrationSeriesItemHtml\(target\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction renderCalibrationTargets/)?.[0] ?? '';
  assert.ok(calibrationSeriesItemSource, 'calibration list item renderer should be discoverable');
  assert.doesNotMatch(calibrationSeriesItemSource, /color-dot/, 'calibration list items should not render color dots');
  assert.match(calibrationSeriesItemSource, /calibrationModeLabel\(target\.mode\)\)\} · \$\{escapeHtml\(calibrationResultSummary\(targetResult\)\)\}/, 'calibration list summaries should show type directly followed by hit status');
  assert.doesNotMatch(calibrationSeriesItemSource, /calibrationTargetVectorLabel\(target\)/, 'calibration list summaries should omit vector values between type and hit status');
  assert.match(app, /calibrationMarkersFromBatchResult/, 'app should flatten batch hits into scene markers');
  assert.match(app, /scene\.setCalibrationMarkers/, 'app should send hits to the 3D scene');
  assert.match(app, /clearVectorCalibration\(\)/, 'orbit lifecycle should clear stale calibration state');
  assert.doesNotMatch(html, /id="calibration-x"/, 'single-vector x input should be replaced by target rows');
  assert.match(scene, /targetName/, 'scene marker normalization should carry target names');
  assert.match(scene, /setCalibrationMarkers/, 'scene should expose calibration marker API');
});

test('stylesheet has balanced block delimiters', async () => {
  for (const file of ['styles.css']) {
    const css = await readFile(file, 'utf8');
    const opens = css.match(/\{/g)?.length ?? 0;
    const closes = css.match(/\}/g)?.length ?? 0;
    assert.equal(closes, opens, `${file} should have balanced braces so later layout rules keep applying`);
  }
});

test('backend compute contract and visible task controls are present', async () => {
  const [html, app, pool, worker] = await Promise.all([
    readFile('index.html', 'utf8'), readFile('js/app.mjs', 'utf8'),
    readFile('server/pool.mjs', 'utf8'), readFile('server/worker.mjs', 'utf8'),
  ]);
  assert.equal(await fileExists('js/backend-client.mjs'), true, 'browser transport should exist');
  for (const id of ['backend-status', 'backend-detail', 'backend-worker-count', 'backend-queue-count',
    'backend-job-label', 'backend-job-progress', 'backend-job-percent', 'backend-cancel',
    'backend-retry', 'backend-jobs', 'backend-log']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should be exposed in the UI`);
  }
  assert.match(app, /BackendClient/, 'app should use the backend transport');
  assert.match(app, /backend\.run\('prepare'/, 'orbit preparation should be submitted to the backend');
  assert.match(app, /backend\.run\('calibration'/, 'vector calibration should be submitted to the backend');
  assert.match(app, /scene\.setComputedFrame\(result\)/, 'scene should display server computed states');
  assert.match(pool, /node:worker_threads/, 'compute pool should use separate worker threads');
  assert.match(worker, /node:worker_threads/, 'compute worker should receive thread messages');
});

test('static app wires Earth self-rotation, graticule, and TXT batch import', async () => {
  const app = await readFile('js/app.mjs', 'utf8');
  const scene = await readFile('js/scene.mjs', 'utf8');

  assert.match(app, /parseOrbitFile/, 'app should parse TXT orbit batches');
  assert.match(app, /importTxt/, 'app should wire TXT import');
  assert.match(app, /els\.importTxt/, 'app should read the TXT file input');
  assert.match(scene, /EARTH_SIDEREAL_DAY_SECONDS/, 'scene should define a sidereal Earth rotation period');
  assert.match(scene, /earthRotationAngleAt/, 'scene should expose testable Earth rotation math');
  assert.match(scene, /frameAxesRotationAngleAt/, 'scene should expose testable frame axes rotation math');
  assert.match(scene, /createEarthGraticule/, 'scene should render 3D earth latitude and longitude lines');
  assert.match(scene, /graticuleGroup/, 'scene should expose a graticule group for toggling');
  assert.match(scene, /this\.earthBody\.rotation\.y = earthRotationAngleAt\(elapsedSeconds\)/, 'scene update should rotate Earth by simulation time');
});

test('local server entrypoint and Windows launch script are present', async () => {
  assert.equal(await fileExists('server.mjs'), true, 'server.mjs should exist');
  assert.equal(await fileExists('start-workbench.bat'), true, 'start-workbench.bat should exist');

  const script = await readFile('start-workbench.bat', 'utf8');
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /node(?:\.exe)? server\.mjs/, 'README should document local server launch');
  assert.match(readme, /ECI/, 'README should document ECI frame');
  assert.match(script, /%~dp0/, 'script should run from its own directory');
  assert.match(script, /PORT=4174/, 'script should provide the default local port');
  assert.match(script, /server\.mjs/, 'script should start the static server');
  assert.match(readme, /start-workbench\.bat/, 'README should document the launch script');
});

