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
  assert.equal(await fileExists('js/app.mjs'), true, 'app module should exist');
  assert.equal(await fileExists('js/scene.mjs'), true, 'scene module should exist');
  assert.equal(await fileExists('js/groundtrack.mjs'), true, 'ground-track math module should exist');
  assert.equal(await fileExists('js/groundtrack-history.mjs'), true, 'ground-track history module should exist');
  assert.equal(await fileExists('js/groundtrack-view.mjs'), true, 'ground-track map renderer should exist');
  assert.equal(await fileExists('vendor/three.module.js'), true, 'Three.js should be vendored locally');
  assert.equal(await fileExists('assets/textures/earth_blue_marble_topo_5400.jpg'), true, 'earth texture should be local');
  assert.equal(await fileExists('assets/maps/dark-world-map.svg'), true, 'offline dark world map should be local');

  const html = await readFile('index.html', 'utf8');
  assert.match(html, /\.\/vendor\//, 'index should preload or reference local vendor assets');
  assert.match(html, /assets\/favicon\.svg/, 'index should use a local favicon');
  assert.match(html, /Ω \/ °/, 'RAAN label should use Ω and °');
  assert.match(html, /ν \/ °/, 'true anomaly label should use ν and °');
  assert.doesNotMatch(html, /deg/, 'visible unit text should not use deg');
});

test('right sidebar module architecture is present', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('styles.css', 'utf8');
  const app = await readFile('js/app.mjs', 'utf8');

  for (const moduleName of ['workbench', 'groundTrack', 'assets', 'info', 'console', 'settings']) {
    assert.match(html, new RegExp(`data-module-nav="${moduleName}"`), `${moduleName} nav button should exist`);
  }
  assert.match(html, /module-sidebar/, 'right module sidebar should exist');
  assert.match(html, /data-module-panel="workbench"/, 'workbench should be a side module panel');
  assert.match(html, /data-module-panel="assets"/, 'assets should be a side module panel');
  assert.match(html, /data-module-panel="settings"/, 'settings should be a side module panel');
  assert.match(html, /id="info-modal"/, 'help should open as a modal');
  assert.match(html, /id="console-panel"/, 'console should open as a bottom panel');
  assert.match(html, /data-module-pin="workbench"/, 'workbench should have a pin button');
  assert.match(html, /data-module-pin="groundTrack"/, 'ground-track panel should have a pin button');
  assert.match(html, /data-module-pin="assets"/, 'assets should have a pin button');
  assert.match(html, /data-module-pin="settings"/, 'settings should have a pin button');
  assert.match(html, /class="button-icon pin-icon"/, 'pin buttons should use the optimized pin icon');
  assert.doesNotMatch(html, /id="ground-track-toggle"/, 'bottom ground-track button should be removed');
  assert.doesNotMatch(html, /workbench-hover-zone/, 'old hover strip should be removed');

  assert.match(css, /--module-sidebar-width:\s*72px/, 'sidebar width should match the requested wider layout');
  assert.match(css, /--module-panel-width:\s*min\(420px,\s*30vw\)/, 'side panels should be reduced to 75% of the previous 560px/40vw width');
  assert.match(css, /module-sidebar/, 'CSS should style the module sidebar');
  assert.match(css, /side-module-panel/, 'CSS should style side module panels');
  assert.match(css, /side-panel-open/, 'CSS should move top and bottom controls away from side panels');
  assert.match(css, /\.top-bar\s*\{[\s\S]*?flex-direction:\s*column/, 'status cards should stack below the workbench title');
  assert.match(css, /\.top-bar\s*\{[\s\S]*?gap:\s*28px/, 'status cards should sit one workbench title font-height below the title');
  assert.match(css, /\.status-grid\s*\{[\s\S]*?width:\s*150px[\s\S]*?min-width:\s*150px/, 'status cards should be 75% of the previous 200px width');
  assert.match(css, /body\.drawer-closed \.status-grid\s*\{[\s\S]*?width:\s*150px[\s\S]*?min-width:\s*150px/, 'status cards should keep the shortened width when the drawer is closed');
  assert.match(css, /\.status-menu\s*\{[\s\S]*?left:\s*calc\(100% \+ 10px\)/, 'status menus should expand to the right of each card');
  assert.match(css, /\.status-card\.is-open \.status-menu\s*\{[\s\S]*?max-height:\s*320px[\s\S]*?opacity:\s*1[\s\S]*?transition:\s*none[\s\S]*?transition-delay:\s*0s/, 'click-open status menus should become visible immediately');
  assert.match(css, /\.status-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/, 'status cards should display label and value on one compact row');
  assert.match(css, /\.status-card > strong\s*\{[\s\S]*?font-family:\s*"Microsoft YaHei"/, 'status card values should use Microsoft YaHei');
  assert.match(css, /\.status-card\.is-open strong\s*\{[\s\S]*?color:\s*#568c87/, 'expanded status value should use the requested theme color');
  assert.match(css, /\.status-card\s*\{[\s\S]*?min-height:\s*42px/, 'status cards should use a shorter row height');
  assert.match(css, /\.ground-track-highlight-grid \.toggle-row\s*\{[\s\S]*?display:\s*flex/, 'ground-track highlight checkboxes should align with their text');
  assert.match(css, /\.ground-track-highlight-grid \.toggle-row input\s*\{[\s\S]*?width:\s*auto/, 'ground-track highlight checkboxes should keep native checkbox width');
  assert.match(css, /\.simulation-time-panel\s*\{[\s\S]*?cursor:\s*pointer/, 'simulation time readout should communicate that it is interactive');
  assert.match(css, /\.simulation-time-panel:hover[\s\S]*?border-color:\s*rgba\(86,\s*140,\s*135,\s*0\.86\)/, 'simulation time readout should highlight like status cards on hover');
  assert.match(css, /\.pin-button \.pin-icon\s*\{[\s\S]*?transform:\s*rotate\(-18deg\)/, 'pin buttons should angle the optimized pin icon when not pinned');
  assert.match(css, /\.pin-button(?:\.is-pinned|\[aria-pressed="true"\]) \.pin-icon\s*\{[\s\S]*?transform:\s*rotate\(0deg\)/, 'pinned windows should show a straight active pin icon');

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

  assert.match(html, /仿真起始 UTC 时间/, 'workbench should start with UTC simulation time');
  assert.match(html, /辅助设置/, 'scene controls should be renamed');
  assert.match(html, /id="toggle-graticule"/, '3D earth graticule toggle should exist');
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

  assert.match(html, /星下点轨迹选择/, 'ground-track filter title should be updated');
  assert.match(html, /轨迹显示设置/, 'ground-track display title should be updated');
  assert.match(html, /ground-track-section-panel[\s\S]*星下点轨迹选择/, 'ground-track filter area should have a panel frame');
  assert.match(html, /ground-track-section-panel[\s\S]*轨迹显示设置/, 'ground-track display settings area should have a panel frame');
  assert.match(html, /ground-track-section-panel[\s\S]*区域统计/, 'ground-track stats area should have a panel frame');
  assert.match(html, /id="ground-track-minimize"/, 'ground-track panel should support minimize');
  assert.match(html, /id="ground-track-mode-toggle"/, 'window and fullscreen should be combined into one control');
  assert.match(html, /id="ground-track-highlight-longitude"/, 'longitude highlight toggle should exist');
  assert.match(html, /id="ground-track-highlight-latitude"/, 'latitude highlight toggle should exist');
  assert.match(html, /id="ground-track-highlight-equator"/, 'equator highlight toggle should exist');
  assert.match(html, /id="ground-track-cursor-guides"/, 'cursor guide toggle should exist');
  assert.match(html, /value="day"/, 'time unit selector should include day');
  assert.doesNotMatch(html, /导出 CSV/, 'CSV export should be removed from the ground-track panel');
  assert.match(html, /id="pause-button"[\s\S]*<path d="M9 6v12"><\/path>[\s\S]*<path d="M15 6v12"><\/path>/, 'pause icon bars should be separate strokes');
  assert.doesNotMatch(html, /M8 5h3v14H8z/, 'pause icon should not use touching filled bars');
  assert.match(html, /id="reset-time"[\s\S]*class="button-icon reset-icon"[\s\S]*class="reset-icon-arc" d="M6\.1 17\.3A8\.2 8\.2 0 1 0 7\.2 5\.6"[\s\S]*class="reset-icon-head" d="M4\.4 2\.8 2\.3 13\.7 12\.5 10\.8z"/, 'reset icon should use a large counterclockwise arrow matching the reference image');
  assert.match(css, /#pause-button \.button-icon path[\s\S]*?stroke-linecap:\s*round/, 'pause icon should use stroked separated bars');
  assert.match(css, /#reset-time \.reset-icon-arc\s*\{[\s\S]*?stroke-width:\s*4\.2/, 'reset icon arc should be thinner while keeping the reference arrow shape');
  assert.match(css, /#reset-time \.reset-icon-head\s*\{[\s\S]*?fill:\s*currentColor/, 'reset icon should use a filled arrow head like the reference image');
  assert.match(css, /\.ground-track-panel\.is-fullscreen\s*\{[\s\S]*?bottom:\s*var\(--bottom-action-top-gap\)/, 'fullscreen ground-track panel should align its bottom with the run row top');

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
  assert.match(html, /<h3>其他功能<\/h3>/, 'workbench should expose an other-functions panel');
  assert.match(html, /位置\/速度标定/, 'calibration tool title should exist');
  assert.match(html, /data-calibration-mode="position"/, 'position calibration mode button should exist');
  assert.match(html, /data-calibration-mode="velocity"/, 'velocity calibration mode button should exist');
  assert.match(html, /id="calibration-x"/, 'x vector input should exist');
  assert.match(html, /id="calibration-y"/, 'y vector input should exist');
  assert.match(html, /id="calibration-z"/, 'z vector input should exist');
  assert.match(html, /id="calibration-submit"/, 'calibration submit button should exist');
  assert.match(html, /id="calibration-clear"/, 'calibration clear button should exist');
  assert.match(html, /id="calibration-results"/, 'calibration results container should exist');
  assert.match(css, /\.calibration-tool/, 'calibration tool should be styled');
  assert.match(css, /\.calibration-mode-button\.is-active/, 'active mode should be styled');
  assert.match(css, /\.calibration-result-item/, 'result items should be styled');
  assert.match(app, /calibrateOrbitVectors/, 'app should import vector calibration solver');
  assert.match(app, /runVectorCalibration/, 'app should run vector calibration');
  assert.match(app, /clearVectorCalibration/, 'app should clear vector calibration');
  assert.match(app, /renderCalibrationResults/, 'app should render vector calibration results');
  assert.match(app, /calibrationMode:\s*'position'/, 'app should default calibration mode to position');
  assert.match(app, /calibrationResult:\s*null/, 'app should track the last calibration result');
  assert.match(app, /scene\.setCalibrationMarkers/, 'app should send hits to the 3D scene');
  assert.match(app, /clearVectorCalibration\(\)/, 'orbit lifecycle should clear stale calibration state');
  assert.match(app, /data-calibration-mode/, 'app should bind calibration mode buttons');
  assert.match(scene, /setCalibrationMarkers/, 'scene should expose calibration marker API');
});

test('stylesheet has balanced block delimiters', async () => {
  const css = await readFile('styles.css', 'utf8');
  const opens = css.match(/\{/g)?.length ?? 0;
  const closes = css.match(/\}/g)?.length ?? 0;

  assert.equal(closes, opens, 'CSS should have balanced braces so later layout rules keep applying');
});

test('static app wires Earth self-rotation, graticule, and TXT batch import', async () => {
  const app = await readFile('js/app.mjs', 'utf8');
  const scene = await readFile('js/scene.mjs', 'utf8');

  assert.match(app, /parseOrbitText/, 'app should parse TXT orbit batches');
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
  assert.match(script, /PORT=4173/, 'script should provide the default local port');
  assert.match(script, /server\.mjs/, 'script should start the static server');
  assert.match(readme, /start-workbench\.bat/, 'README should document the launch script');
});
