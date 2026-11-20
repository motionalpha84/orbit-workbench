import {
  formatDuration,
  formatNumber,
} from './orbit.mjs';
import { BackendClient } from './backend-client.mjs';
import { WireRecordCache } from './wire-records.mjs';
import { pageRecords } from './list-pagination.mjs';
import { renderTaskTable } from './task-table.mjs';
import { SchematicScene } from './schematic-scene.mjs';
import {
  DEFAULT_ORBIT_COLORS,
  hexToRgb,
  nextOrbitColor,
  displayColorOnLight,
  normalizeHexColor,
  rgbToHex,
} from './color.mjs';
import { parseElementGroupText, parseOrbitFile, parseTrajectoryText } from './importers.mjs';
import { smoothTrajectory } from './trajectory.mjs';
import { BODIES, bodyById, modelForBody, modelsForBody } from './bodies.mjs';
import {
  groundTrackBudget,
  groundTrackCsv,
  groundTrackRegionStats,
  utcMsFromInput,
} from './groundtrack.mjs';
import { GroundTrackView, formatUtc } from './groundtrack-view.mjs';
import { parseCalibrationVector } from './vector-calibration.mjs';
import { classifyOrbitRecord, ORBIT_CLASSES } from './orbit-class.mjs';
import { initI18n, tr } from './i18n.mjs';
import {
  RM, VIEW_MS, closeDropdowns, colorFlyoutOpen, dropIn, initColorFlyout, initDropdowns, initListFades,
  initMotes, initPanelToggles, initSegmentedSelects, isSwitching, markSwatch, refreshListFades, rollSet, scramble,
  setColorFlyout, shutter, syncSegmentedSelects,
} from './ui-shell.mjs';

const STORAGE_KEY = 'eci-orbit-workbench:v1';
const ASSET_LIBRARY_KEY = 'eci-orbit-workbench:asset-groups:v1';
// Three persistent views share the stage; drawers (and the help modal) open over them.
const VIEW_MODULES = ['workbench', 'groundTrack', 'console'];
const DRAWER_MODULES = new Set(['assets', 'calibration', 'settings']);
const FRAME_RATE_LIMITS = [30, 60, 120, 0]; // 0 follows the display refresh rate
const VIEW_META = {
  workbench: ['轨道工作台', 'ORBIT DECK'],
  groundTrack: ['星下点分析', 'GROUND TRACK'],
  console: ['计算任务', 'COMPUTE QUEUE'],
};
const LIGHT_MAP_SRC = './assets/maps/firefly-world-map.svg';

const els = {
  body: document.body,
  canvas: document.querySelector('#scene-canvas'),
  moduleSidebar: document.querySelector('#module-sidebar'),
  moduleButtons: Array.from(document.querySelectorAll('[data-module-nav]')),
  modulePanels: Array.from(document.querySelectorAll('[data-module-panel]')),
  modulePinButtons: Array.from(document.querySelectorAll('[data-module-pin]')),
  views: Array.from(document.querySelectorAll('[data-view]')),
  deckCanvasSlot: document.querySelector('#deck-canvas-slot'),
  miniCanvas: document.querySelector('#mini-canvas'),
  groundTrackCount: document.querySelector('#ground-track-count'),
  trackCanvasSlot: document.querySelector('#track-canvas-slot'),
  workbench: document.querySelector('#workbench'),
  form: document.querySelector('#orbit-form'),
  editBanner: document.querySelector('#edit-banner'),
  editName: document.querySelector('#edit-name'),
  editCancel: document.querySelector('#edit-cancel'),
  submitButton: document.querySelector('#submit-button'),
  clearForm: document.querySelector('#clear-form'),
  formErrors: document.querySelector('#form-errors'),
  orbitList: document.querySelector('#orbit-list'),
  orbitLists: Array.from(document.querySelectorAll('.js-orbit-list')),
  orbitCount: document.querySelector('#orbit-count'),
  orbitListCount: document.querySelector('#orbit-list-count'),
  frameValue: document.querySelector('#frame-value'),
  bodyValue: document.querySelector('#body-value'),
  modelFlyRows: [...document.querySelectorAll('[data-model-fly]')],
  bodyOptions: document.querySelector('#body-options'),
  dynamicsNote: document.querySelector('#dynamics-note'),
  modelSumBody: document.querySelector('#model-sum-body'),
  modelSumBodyNote: document.querySelector('#model-sum-body-note'),
  modelSumModel: document.querySelector('#model-sum-model'),
  modelSumModelNote: document.querySelector('#model-sum-model-note'),
  statusOrbitMenu: document.querySelector('#status-orbit-menu'),
  orbitTooltip: document.querySelector('#orbit-tooltip'),
  selectedOrbitName: document.querySelector('#selected-orbit-name'),
  selectedOrbitHud: document.querySelector('#selected-orbit-hud'),
  selectedOrbitCode: document.querySelector('#selected-orbit-code'),
  selectedOrbitMulti: document.querySelector('#selected-orbit-multi'),
  selectedOrbitClass: document.querySelector('#selected-orbit-class'),
  selectedOrbitPeriodCell: document.querySelector('#selected-orbit-period-cell'),
  selectedOrbitPeriod: document.querySelector('#selected-orbit-period'),
  selectedOrbitPeriodUnit: document.querySelector('#selected-orbit-period-unit'),
  selectedOrbitPeriapsis: document.querySelector('#selected-orbit-periapsis'),
  selectedOrbitApoapsis: document.querySelector('#selected-orbit-apoapsis'),
  selectedOrbitSpeed: document.querySelector('#selected-orbit-speed'),
  stateVectorName: document.querySelector('#state-vector-name'),
  stateVector: ['px', 'py', 'pz', 'vx', 'vy', 'vz'].map((key) => document.querySelector(`#state-${key}`)),
  emptyState: document.querySelector('#empty-state'),
  playToggle: document.querySelector('#play-toggle'),
  runLimitToggle: document.querySelector('#run-limit-toggle'),
  runLimitMenu: document.querySelector('#run-limit-menu'),
  runDurationLimit: document.querySelector('#run-duration-limit'),
  pauseButton: document.querySelector('#pause-button'),
  resetTime: document.querySelector('#reset-time'),
  frontView: document.querySelector('#front-view'),
  topView: document.querySelector('#top-view'),
  resetView: document.querySelector('#reset-view'),
  planeViewToggle: document.querySelector('#plane-view-toggle'),
  planeViewPop: document.querySelector('#plane-view-pop'),
  planeViewForm: document.querySelector('#plane-view-form'),
  planeViewInc: document.querySelector('#plane-view-inc'),
  planeViewRaan: document.querySelector('#plane-view-raan'),
  planeViewError: document.querySelector('#plane-view-error'),
  planeViewFromOrbit: document.querySelector('#plane-view-from-orbit'),
  toolsPanel: document.querySelector('#tools-panel'),
  speedFactor: document.querySelector('#speed-factor'),
  timeReadoutPanel: document.querySelector('.simulation-time-panel'),
  timeReadout: document.querySelector('#time-readout'),
  timeReadoutUnit: document.querySelector('#time-readout-unit'),
  runLimitValue: document.querySelector('#run-limit-value'),
  clockUtc: document.querySelector('#clock-utc'),
  telemetryFrame: document.querySelector('#telem-frame'),
  telemetryPower: document.querySelector('#telem-power'),
  telemetryTemp: document.querySelector('#telem-temp'),
  screenshotButton: document.querySelector('#screenshot-button'),
  calibrationTargetEditor: document.querySelector('#calibration-target-editor'),
  calibrationEditorError: document.querySelector('#calibration-editor-error'),
  calibrationTargetList: document.querySelector('#calibration-target-list'),
  calibrationTargetCount: document.querySelector('#calibration-target-count'),
  calibrationAddTarget: document.querySelector('#calibration-add-target'),
  calibrationCancelEdit: document.querySelector('#calibration-cancel-edit'),
  calibrationSubmitAll: document.querySelector('#calibration-submit-all'),
  calibrationClearResults: document.querySelector('#calibration-clear-results'),
  calibrationResults: document.querySelector('#calibration-results'),
  simulationStartUtc: document.querySelector('#simulation-start-utc'),
  groundTrackPanel: document.querySelector('#ground-track-panel'),
  groundTrackClosed: document.querySelector('#ground-track-closed'),
  groundTrackReopen: document.querySelector('#ground-track-reopen'),
  groundTrackStatsPanel: document.querySelector('#ground-track-stats-panel'),
  groundTrackModeToggle: document.querySelector('#ground-track-mode-toggle'),
  groundTrackMinimize: document.querySelector('#ground-track-minimize'),
  groundTrackClose: document.querySelector('#ground-track-close'),
  groundTrackCanvas: document.querySelector('#ground-track-canvas'),
  groundTrackTooltip: document.querySelector('#ground-track-map-tooltip'),
  groundTrackSelectionSummary: document.querySelector('#ground-track-selection-summary'),
  groundTrackFilterList: document.querySelector('#ground-track-filter-list'),
  groundTrackStats: document.querySelector('#ground-track-stats'),
  groundTrackCsv: document.querySelector('#ground-track-csv'),
  groundTrackResetView: document.querySelector('#ground-track-reset-view'),
  groundTrackWindowMode: document.querySelector('#ground-track-window-mode'),
  groundTrackPastRevs: document.querySelector('#ground-track-past-revs'),
  groundTrackRetentionTime: document.querySelector('#ground-track-retention-time'),
  groundTrackRetentionUnit: document.querySelector('#ground-track-retention-unit'),
  groundTrackHighlightLongitude: document.querySelector('#ground-track-highlight-longitude'),
  groundTrackHighlightLatitude: document.querySelector('#ground-track-highlight-latitude'),
  groundTrackHighlightEquator: document.querySelector('#ground-track-highlight-equator'),
  groundTrackCursorGuides: document.querySelector('#ground-track-cursor-guides'),
  performanceMode: document.querySelector('#ground-track-performance-mode'),
  customMemory: document.querySelector('#ground-track-custom-memory'),
  customMemoryValue: document.querySelector('#custom-memory-value'),
  customMemoryGrid: document.querySelector('#custom-memory-grid'),
  performanceHint: document.querySelector('#performance-hint'),
  frameRateLimit: document.querySelector('#frame-rate-limit'),
  frameRateValue: document.querySelector('#frame-rate-value'),
  exportNamePrefix: document.querySelector('#export-name-prefix'),
  exportGroundTrackPng: document.querySelector('#export-ground-track-png'),
  assetDirtyState: document.querySelector('#asset-dirty-state'),
  assetGroupName: document.querySelector('#asset-group-name'),
  assetSaveGroup: document.querySelector('#asset-save-group'),
  assetRenameGroup: document.querySelector('#asset-rename-group'),
  assetGroupList: document.querySelector('#asset-group-list'),
  infoModal: document.querySelector('#info-modal'),
  infoClose: document.querySelector('#info-close'),
  moduleScrim: document.querySelector('#module-scrim'),
  consolePanel: document.querySelector('#console-panel'),
  exitPage: document.querySelector('#exit-page'),
  exportJson: document.querySelector('#export-json'),
  importJson: document.querySelector('#import-json'),
  importTxt: document.querySelector('#import-txt'),
  importGroupTxt: document.querySelector('#import-group-txt'),
  importTrajectoryTxt: document.querySelector('#import-trajectory-txt'),
  importDataToggle: document.querySelector('#import-data-toggle'),
  importDataOptions: document.querySelector('#import-data-options'),
  trajectorySection: document.querySelector('#trajectory-section'),
  trajectoryList: document.querySelector('#trajectory-list'),
  trajectoryCount: document.querySelector('#trajectory-count'),
  importDialog: document.querySelector('#import-dialog'),
  importDialogKind: document.querySelector('#import-dialog-kind'),
  importDialogCount: document.querySelector('#import-dialog-count'),
  importDialogFile: document.querySelector('#import-dialog-file'),
  importDialogMeta: document.querySelector('#import-dialog-meta'),
  importDialogTable: document.querySelector('#import-dialog-table'),
  importDialogPreview: document.querySelector('#import-dialog-preview'),
  importDialogNote: document.querySelector('#import-dialog-note'),
  importBodyChoice: document.querySelector('#import-body-choice'),
  importFrameChoice: document.querySelector('#import-frame-choice'),
  importDialogError: document.querySelector('#import-dialog-error'),
  importDialogConfirm: document.querySelector('#import-dialog-confirm'),
  helpFormatTabs: [...document.querySelectorAll('[data-help-format-tab]')],
  helpFormatDownload: document.querySelector('#help-format-download'),
  clearAll: document.querySelector('#clear-all'),
  toggles: {
    axes: document.querySelector('#toggle-axes'),
    ecliptic: document.querySelector('#toggle-ecliptic'),
    radius: document.querySelector('#toggle-radius'),
    reference: document.querySelector('#toggle-reference'),
  },
  color: {
    picker: document.querySelector('[name="colorPicker"]'),
    r: document.querySelector('[name="colorR"]'),
    g: document.querySelector('[name="colorG"]'),
    b: document.querySelector('[name="colorB"]'),
    hex: document.querySelector('[name="colorHex"]'),
    preview: document.querySelector('#color-preview'),
    hexLabel: document.querySelector('#color-hex-label'),
    flyoutSwatch: document.querySelector('#color-flyout-swatch'),
    flyoutHex: document.querySelector('#color-flyout-hex'),
  },
};

// The approved Firefly schematic draws both the workbench stage and the ground-track viewport.
// `?renderer=webgl` keeps the v2.1 Three.js scene available (one canvas moved between slots).
const useWebGlScene = new URLSearchParams(location.search).get('renderer') === 'webgl';
const scene = useWebGlScene
  ? new (await import('./scene.mjs')).OrbitScene(els.canvas, { theme: 'light' })
  : new SchematicScene(els.canvas);
const miniScene = useWebGlScene ? null : new SchematicScene(els.miniCanvas, { mini: true, source: scene });
if (useWebGlScene) els.miniCanvas?.remove();
const groundTrackView = new GroundTrackView({
  canvas: els.groundTrackCanvas,
  tooltip: els.groundTrackTooltip,
  selectionSummary: els.groundTrackSelectionSummary,
  mapSrc: LIGHT_MAP_SRC,
  theme: 'light',
  readout: document.querySelector('#ground-track-readout'),
});

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

function createCalibrationDraftTarget(overrides = {}) {
  return {
    name: overrides.name ?? '',
    mode: overrides.mode === 'velocity' ? 'velocity' : 'position',
    vector: {
      x: overrides.vector?.x ?? '',
      y: overrides.vector?.y ?? '',
      z: overrides.vector?.z ?? '',
    },
  };
}

function cloneCalibrationTarget(target = {}) {
  return createCalibrationDraftTarget({
    name: target.name ?? '',
    mode: target.mode,
    vector: target.vector,
  });
}

const state = {
  orbits: [],
  selectedIds: [],
  selectedId: null,
  editingId: null,
  isPlaying: false,
  activeView: 'workbench',
  activeModule: null,
  committedModule: null,
  previewModule: null,
  previewReturnModule: null,
  modulePins: {
    assets: false,
    calibration: false,
    settings: false,
  },
  hoverPreviewTimer: null,
  elapsedSeconds: 0,
  lastFrameMs: performance.now(),
  runStartedAtMs: null,
  runLimitSeconds: 0,
  speedFactor: Number(els.speedFactor.value),
  timeReadoutUnit: 's',
  simulationStartUtc: '',
  groundTrackPanel: 'closed',
  groundTrackFilters: {},
  groundTrackWindow: {
    mode: 'revs',
    pastRevs: 2,
    pastSeconds: 3600,
    timeUnit: 'min',
  },
  groundTrackOptions: {
    highlightLongitude: false,
    highlightLatitude: false,
    highlightEquator: true,
    cursorGuides: true,
  },
  performanceMode: 'high',
  customMemoryGb: 8,
  frameRateLimit: 60,
  exportNamePrefix: 'ground-track',
  assetGroups: [],
  currentAssetId: null,
  isSceneDirty: false,
  groundTrackTracks: [],
  lastGroundTrackRenderMs: 0,
  calibrationDraftTarget: createCalibrationDraftTarget(),
  calibrationEditingTargetId: null,
  calibrationEditorError: '',
  calibrationTargets: [],
  trajectories: [],
  calibrationResult: null,
  calibrationExpandedTargetIds: new Set(),
  hiddenCalibrationTargetIds: new Set(),
  frame: 'ECI',
  centerBody: 'earth',
  perturbationModel: 'two-body',
  overlays: {
    axes: true,
    graticule: true,
    ecliptic: false,
    radius: true,
    reference: true,
  },
};

let workspaceOperation = 0;
let calibrationOperation = 0;
// Help opened from a module's 格式 button hands back to that module (and the button) on close.
let helpReturn = null;
let frameRevision = 0;
let frameDirty = true;
let framePending = false;
let frameLastRequestedAt = 0;
let frameRetryAt = 0;
let referencePending = false;
let groundResetToken = 0;
const groundResetIds = new Set();
const backendSessionId = uuid();
let computedStates = new Map();
let persistenceReady = false;
let historyLimitNotified = false;
const backend = new BackendClient({ onChange: renderBackendStatus });
const wireCache = new WireRecordCache();
const wireRecords = () => wireCache.get(state.orbits);
let saveTimer = null;
let savePending = false;

function renderBackendStatus(client = backend) {
  const set = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  const jobs = [...client.jobs.values()];
  const active = jobs.filter((job) => ['queued', 'running'].includes(job.status));
  const current = active[0] ?? jobs.at(-1);
  const progress = current ? Math.round((Number(current.progress) || 0) * (Number(current.progress) <= 1 ? 100 : 1)) : 0;
  set('backend-status-text', client.connected ? 'LINK · NODE_01' : 'LINK LOST · 计算服务未连接');
  set('ops-link-state', client.connected ? 'ONLINE' : 'OFFLINE');
  document.getElementById('stat-connection')?.classList.toggle('off', !client.connected);
  set('backend-detail', client.connected ? '本机后台 · 独立计算线程' : client.error || '正在连接本机计算服务…');
  const health = client.health ?? {};
  const roll = (id, value) => { const element = document.getElementById(id); if (element) rollSet(element, String(value)); };
  const workers = Number(health.workers ?? health.pool?.size);
  roll('backend-worker-count', Number.isFinite(workers) ? workers : '—');
  roll('backend-queue-count', String(health.queued ?? active.filter((job) => job.status === 'queued').length).padStart(2, '0'));
  roll('queue-running', String(health.running ?? active.filter((job) => job.status === 'running').length).padStart(2, '0'));
  roll('queue-completed', String(health.completed ?? jobs.filter((job) => job.status === 'completed').length).padStart(2, '0'));
  roll('queue-failed', String(health.failed ?? jobs.filter((job) => job.status === 'failed').length).padStart(2, '0'));
  renderWorkerSlots(Number.isFinite(workers) ? workers : 0, jobs.filter((job) => job.status === 'running'));
  set('backend-job-label', current?.label ?? '就绪，等待计算任务');
  set('backend-job-percent', `${progress}%`);
  set('backend-job-sub', current ? `${current.type ?? ''} · ${String(current.id ?? '').slice(0, 8)}` : '—');
  const bar = document.getElementById('backend-job-progress');
  if (bar) bar.value = progress;
  const cancel = document.getElementById('backend-cancel');
  if (cancel) cancel.disabled = active.length === 0;
  const status = document.getElementById('backend-status');
  if (status) {
    status.dataset.state = client.connected ? 'online' : 'offline';
    status.classList.toggle('off', !client.connected);
  }
  const list = document.getElementById('backend-jobs');
  const labels = { queued: '排队', running: '计算中', completed: '完成', failed: '失败', cancelled: '已取消', canceled: '已取消' };
  if (list) list.innerHTML = jobs.slice(-5).reverse().map((job) => `<div class="backend-job-row"><span>${escapeHtml(job.label)}</span><small>${labels[job.status] ?? escapeHtml(job.status)}</small></div>`).join('') || '<span class="backend-idle">计算结果将在此显示</span>';
  renderConsole(client.logs);
  renderTaskTable(client);
}

// Worker slots: one cell per backend thread, filled by running jobs in order with their progress.
function renderWorkerSlots(count, running) {
  const box = document.getElementById('worker-slots');
  if (!box) return;
  const slots = Math.max(1, Math.min(16, count || 1));
  if (box.children.length !== slots) {
    box.replaceChildren(...Array.from({ length: slots }, (_, index) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<span>W${String(index + 1).padStart(2, '0')}</span><b>IDLE</b>`;
      return slot;
    }));
  }
  [...box.children].forEach((slot, index) => {
    const job = running[index];
    slot.classList.toggle('busy', Boolean(job));
    slot.style.setProperty('--p', job ? `${Math.round((Number(job.progress) || 0) * 100)}%` : '0%');
    const label = slot.querySelector('b');
    const text = job ? `${Math.round((Number(job.progress) || 0) * 100)}%` : 'IDLE';
    if (label.textContent !== text) label.textContent = text;
  });
}

// Console: oldest first, timestamp · tag · message, newest line types in and stays in view.
const consoleSeen = new Set();
function renderConsole(logs = []) {
  const box = document.getElementById('backend-log');
  if (!box) return;
  if (!logs.length) { box.textContent = '计算服务初始化中…'; return; }
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  const lines = [...logs].reverse().map((entry) => {
    const match = /^(\S+)\s+(.*)$/.exec(entry) ?? [null, '', entry];
    const message = match[2];
    const kind = /失败|错误|中断|超时|error/i.test(message) ? 'err' : /暂停|裁剪|重置|取消/.test(message) ? 'warn' : '';
    const tag = kind === 'err' ? 'ERROR' : kind === 'warn' ? 'WARN' : /已完成/.test(message) ? 'DONE' : /已提交/.test(message) ? 'SUBMIT' : 'INFO';
    const fresh = !consoleSeen.has(entry);
    consoleSeen.add(entry);
    return `<div class="ln${kind ? ` ${kind}` : ''}${fresh ? ' new' : ''}"><span class="ts" data-i18n-skip>${escapeHtml(match[1])}</span> <span class="tag" data-i18n-skip>[${tag}]</span> <span>${escapeHtml(message)}</span></div>`;
  });
  box.innerHTML = `${lines.join('')}<span class="caret" aria-hidden="true"></span>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function invalidateComputedFrame() {
  frameRevision += 1;
  frameDirty = true;
  computedStates.clear();
  scene.setComputedFrame(null);
}

async function ensureBackendReferences() {
  const limit = currentGroundTrackBudget().max3dReferenceSamples;
  if (referencePending || !state.orbits.some((record) => record.referenceModel !== state.perturbationModel || record.referenceLimit !== limit)) return;
  referencePending = true;
  const records = state.orbits;
  const model = state.perturbationModel;
  const operation = workspaceOperation;
  let superseded = false;
  invalidateComputedFrame();
  for (const record of records) {
    if (record.referenceModel !== model) record.reference = [];
  }
  scene.syncOrbits(records, model);
  try {
    const prepared = await backend.run('prepare', {
      records: records.map(serializeOrbit), perturbationModel: model,
      referenceSampleCount: limit,
    }, `更新 ${model.toUpperCase()} 参考轨道`);
    if (state.orbits !== records || state.perturbationModel !== model || operation !== workspaceOperation || limit !== currentGroundTrackBudget().max3dReferenceSamples) {
      superseded = true;
      return;
    }
    const byId = new Map(prepared.records.map((record) => [record.id, record]));
    for (const record of records) {
      Object.assign(record, byId.get(record.id), { referenceModel: model, referenceLimit: limit });
    }
    scene.syncOrbits(state.orbits, model);
    frameDirty = true;
  } catch (error) { showErrors(error.message); }
  finally {
    referencePending = false;
    if (superseded) ensureBackendReferences();
  }
}

// Backend frames are fetched at the target frame rate so positions advance every painted frame;
// large constellations cost more per frame, so their fetch rate is capped to keep the backend responsive.
function computedFrameInterval() {
  const target = state.frameRateLimit > 0 ? 1000 / state.frameRateLimit : 1000 / 120;
  const floor = state.orbits.length > 500 ? 100 : state.orbits.length > 100 ? 33 : 0;
  return Math.max(target, floor);
}

async function requestComputedFrame(nowMs) {
  if (framePending || referencePending || nowMs < frameRetryAt || state.orbits.length === 0) return;
  const interval = computedFrameInterval();
  // 2 ms slack: display refreshes land a hair under the interval and would otherwise skip every other fetch
  if ((!state.isPlaying && !frameDirty) || nowMs - frameLastRequestedAt < interval - 2) return;
  const delta = state.isPlaying ? Math.min(0.5, Math.max(0, (nowMs - Math.max(frameLastRequestedAt, state.runStartedAtMs ?? nowMs)) / 1000)) : 0;
  const elapsedSeconds = state.elapsedSeconds + delta * state.speedFactor;
  const revision = frameRevision;
  const spacing = Math.max(interval, nowMs - frameLastRequestedAt);
  frameLastRequestedAt = nowMs;
  framePending = true;
  frameDirty = false;
  const resetIds = [...groundResetIds];
  const budget = currentGroundTrackBudget();
  const activeRecords = state.groundTrackPanel === 'closed' ? [] : activeGroundTrackRecords(budget);
  try {
    const result = await backend.frame({
      records: wireRecords(), elapsedSeconds,
      perturbationModel: state.perturbationModel,
      trailCount: state.orbits.length > 500 ? 32 : state.orbits.length > 100 ? 64 : 130,
      ...(state.groundTrackPanel !== 'closed' ? { groundTrack: {
        sessionId: backendSessionId, resetToken: groundResetToken, resetIds,
        startUtcMs: utcMsFromInput(state.simulationStartUtc, Date.now()),
        activeIds: activeRecords.map((record) => record.id), window: currentGroundTrackWindow(),
        referenceSampleCount: budget.max3dReferenceSamples,
        maxCatchUpPoints: Math.min(2000, Math.max(60, Math.floor(budget.maxGroundTrackSamples / Math.max(1, activeRecords.length)))),
      } } : {}),
    });
    if (revision !== frameRevision) { frameDirty = true; return; }
    state.elapsedSeconds = result.elapsedSeconds;
    computedStates = new Map(result.records.map((record) => [record.id, record.state]));
    scene.setComputedFrame(result);
    if (result.tracks) {
      if (result.groundTrack?.reset && state.groundTrackTracks.some((track) => (track.points?.length ?? 0) > 1)) {
        backend.log('地图历史已重新开始记录：后台会话已重置。');
      }
      if (result.groundTrack?.truncated && !historyLimitNotified) {
        backend.log('地图历史已达到内存预算，最早采样点已裁剪。');
      }
      historyLimitNotified = Boolean(result.groundTrack?.truncated);
      state.groundTrackTracks = result.tracks;
      resetIds.forEach((id) => groundResetIds.delete(id));
      renderGroundTrack({ force: true });
    }
    renderMetrics();
    updateTimeReadout();
    const latency = Math.round(performance.now() - nowMs);
    computeLoad.frame = Math.min(1, latency / spacing);
    computeLoad.frameAt = performance.now();
    const detail = document.getElementById('backend-detail');
    if (detail) detail.textContent = `本机计算 · ${state.orbits.length} 条轨道 · ${latency} ms`;
  } catch (error) {
    frameDirty = true;
    frameRetryAt = performance.now() + 2000;
    state.isPlaying = false;
    state.runStartedAtMs = null;
    backend.log(`播放已暂停 · ${error.message}`);
    await backend.checkHealth();
    showErrors(`计算连接中断：${error.message}。恢复服务后将自动重试。`);
    renderUi();
  } finally { framePending = false; }
}

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `orbit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function currentTimestampLabel() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
}

function utcDatetimeLocalValue(date = new Date()) {
  const utc = new Date(date);
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}T${String(utc.getUTCHours()).padStart(2, '0')}:${String(utc.getUTCMinutes()).padStart(2, '0')}`;
}

function finitePositiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

const TIME_UNIT_SECONDS = {
  s: 1,
  min: 60,
  hr: 3600,
  day: 86400,
};

const TIME_READOUT_UNITS = ['s', 'min', 'hr', 'day'];

function normalizeTimeUnit(unit) {
  return Object.hasOwn(TIME_UNIT_SECONDS, unit) ? unit : 'min';
}

function groundTrackTimeValue(seconds, unit) {
  const value = finitePositiveNumber(seconds, 3600) / TIME_UNIT_SECONDS[normalizeTimeUnit(unit)];
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}

function formatSimulationTimeReadout(seconds, unit = state.timeReadoutUnit) {
  const normalizedUnit = normalizeTimeUnit(unit);
  const value = Math.max(0, Number(seconds) || 0) / TIME_UNIT_SECONDS[normalizedUnit];
  return `T+ ${value.toFixed(1).padStart(7, '0')} ${normalizedUnit}`;
}

function updateTimeReadout() {
  // "T+ 00034.0 s" renders as key / value / unit parts in the bottom-bar readout plate
  const [, value, unit] = formatSimulationTimeReadout(state.elapsedSeconds).split(' ');
  if (els.timeReadout.textContent !== value) els.timeReadout.textContent = value;
  if (els.timeReadoutUnit.textContent !== unit) els.timeReadoutUnit.textContent = unit;
  els.timeReadout.dataset.elapsedSeconds = String(state.elapsedSeconds);
  updateUtcClock();
  const slider = document.getElementById('timeline-scrubber');
  if (slider && document.activeElement !== slider) {
    const period = selectedOrbitRecord()?.orbit?.periodSeconds || 6000;
    const end = Math.max(period, Math.ceil((state.elapsedSeconds + 1) / period) * period);
    slider.max = String(Math.ceil(end));
    slider.value = String(state.elapsedSeconds);
    slider.disabled = !state.orbits.length;
    const range = document.getElementById('timeline-range-label');
    if (range) range.textContent = `0 — ${Math.ceil(end).toLocaleString()} s`;
  }
  if (slider) slider.style.setProperty('--timeline-progress', `${Math.min(100, Math.max(0, Number(slider.value) / Number(slider.max) * 100))}%`);
}

// Bottom-bar UTC: the simulation epoch advanced by the elapsed simulation time.
function updateUtcClock() {
  if (!els.clockUtc) return;
  const startMs = utcMsFromInput(state.simulationStartUtc, Date.now());
  const value = Number.isFinite(startMs) ? formatUtc(startMs + state.elapsedSeconds * 1000) : '—';
  if (els.clockUtc.textContent !== value) els.clockUtc.textContent = value;
}

function cycleSimulationTimeUnit() {
  const currentIndex = TIME_READOUT_UNITS.indexOf(state.timeReadoutUnit);
  state.timeReadoutUnit = TIME_READOUT_UNITS[(currentIndex + 1) % TIME_READOUT_UNITS.length];
  updateTimeReadout();
}

function serializeOrbit(record) {
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    visible: record.visible,
    elements: {
      name: record.name,
      semiMajorAxisKm: record.orbit.elements.semiMajorAxisKm,
      eccentricity: record.orbit.elements.eccentricity,
      inclinationDeg: record.orbit.elements.inclinationDeg,
      raanDeg: record.orbit.elements.raanDeg,
      argPeriapsisDeg: record.orbit.elements.argPeriapsisDeg,
      trueAnomalyDeg: record.orbit.elements.trueAnomalyDeg,
    },
  };
}

function serializeWorkbenchSnapshot() {
  return {
    selectedIds: [...state.selectedIds],
    selectedId: state.selectedId,
    frame: state.frame,
    centerBody: state.centerBody,
    perturbationModel: state.perturbationModel,
    simulationStartUtc: state.simulationStartUtc,
    overlays: { ...state.overlays },
    groundTrackFilters: { ...state.groundTrackFilters },
    groundTrackWindow: { ...state.groundTrackWindow },
    groundTrackOptions: { ...state.groundTrackOptions },
    orbits: state.orbits.map(serializeOrbit),
  };
}

async function buildOrbitRecordsFromSerialized(orbits = [], model = state.perturbationModel) {
  if (!orbits.length) return [];
  const records = orbits.map((item, index) => ({
    id: item.id ?? uuid(),
    name: String(item.name ?? item.elements?.name ?? `Orbit ${index + 1}`).trim(),
    elements: item.elements ?? item,
    color: normalizeHexColor(item.color, nextOrbitColor(index)),
    visible: item.visible !== false,
  }));
  const limit = currentGroundTrackBudget().max3dReferenceSamples;
  const prepared = await backend.run('prepare', {
    records, perturbationModel: model, referenceSampleCount: limit,
  }, `轨道准备 · ${records.length} 条`);
  const byId = new Map(prepared.records.map((item) => [item.id, item]));
  return records.map((record) => ({ ...record, ...byId.get(record.id), referenceModel: model, referenceLimit: limit }));
}

async function applyWorkbenchSnapshot(snapshot = {}) {
  const version = ++workspaceOperation;
  const records = await buildOrbitRecordsFromSerialized(snapshot.orbits ?? [], snapshot.perturbationModel ?? state.perturbationModel);
  if (version !== workspaceOperation) throw new Error('场景已更新，忽略过期导入。');
  state.orbits = records;
  persistenceReady = true;
  state.isPlaying = false;
  state.runStartedAtMs = null;
  state.elapsedSeconds = 0;
  setSelectedOrbitIds(
    Array.isArray(snapshot.selectedIds) ? snapshot.selectedIds : snapshot.selectedId ? [snapshot.selectedId] : [],
    { currentId: snapshot.selectedId, defaultFirst: true },
  );
  state.editingId = null;
  if (snapshot.frame === 'ECI' || snapshot.frame === 'ECEF') state.frame = snapshot.frame;
  if (snapshot.centerBody === 'earth') state.centerBody = snapshot.centerBody;
  if (['two-body', 'j2', 'j3'].includes(snapshot.perturbationModel)) {
    state.perturbationModel = snapshot.perturbationModel;
  }
  if (typeof snapshot.simulationStartUtc === 'string') state.simulationStartUtc = snapshot.simulationStartUtc;
  if (snapshot.overlays && typeof snapshot.overlays === 'object') {
    // V2.2 keeps the earth graticule permanently visible
    state.overlays = { ...state.overlays, ...snapshot.overlays, graticule: true };
  }
  if (snapshot.groundTrackFilters && typeof snapshot.groundTrackFilters === 'object') {
    state.groundTrackFilters = { ...snapshot.groundTrackFilters };
  }
  if (snapshot.groundTrackWindow && typeof snapshot.groundTrackWindow === 'object') {
    state.groundTrackWindow = {
      ...state.groundTrackWindow,
      ...snapshot.groundTrackWindow,
      timeUnit: normalizeTimeUnit(snapshot.groundTrackWindow.timeUnit),
    };
  }
  if (snapshot.groundTrackOptions && typeof snapshot.groundTrackOptions === 'object') {
    state.groundTrackOptions = { ...state.groundTrackOptions, ...snapshot.groundTrackOptions };
  }
  clearGroundTrackHistories();
  clearVectorCalibration();
  resetForm();
}

function markSceneDirty() {
  state.isSceneDirty = true;
  renderAssetLibrary();
}

function saveAssetLibrary() {
  localStorage.setItem(ASSET_LIBRARY_KEY, JSON.stringify({
    version: 1,
    currentAssetId: state.currentAssetId,
    groups: state.assetGroups,
  }));
}

function restoreAssetLibrary() {
  const raw = localStorage.getItem(ASSET_LIBRARY_KEY);
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (Array.isArray(payload?.groups)) state.assetGroups = payload.groups;
    if (typeof payload?.currentAssetId === 'string') state.currentAssetId = payload.currentAssetId;
  } catch (error) {
    console.warn('Failed to restore asset library:', error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function saveState() {
  if (!persistenceReady) return;
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSavedState, 250);
}

function flushSavedState() {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  if (!persistenceReady) return;
  const payload = {
    version: 2,
    selectedIds: [...state.selectedIds],
    selectedId: state.selectedId,
    frame: state.frame,
    centerBody: state.centerBody,
    perturbationModel: state.perturbationModel,
    activeView: state.activeView,
    activeModule: state.committedModule,
    modulePins: state.modulePins,
    overlays: state.overlays,
    simulationStartUtc: state.simulationStartUtc,
    groundTrackPanel: state.groundTrackPanel,
    groundTrackFilters: state.groundTrackFilters,
    groundTrackWindow: state.groundTrackWindow,
    groundTrackOptions: state.groundTrackOptions,
    performanceMode: state.performanceMode,
    customMemoryGb: state.customMemoryGb,
    frameRateLimit: state.frameRateLimit,
    exportNamePrefix: state.exportNamePrefix,
    currentAssetId: state.currentAssetId,
    isSceneDirty: state.isSceneDirty,
    taskTableOpen: Boolean(document.getElementById('task-table')?.open),
    orbits: wireRecords(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    saveAssetLibrary();
  } catch (error) {
    state.isSceneDirty = true;
    renderAssetLibrary();
    showErrors('浏览器存储空间不足或不可写，当前场景仍在内存中。请从资产页导出 JSON 保存。');
    backend.log(`本地保存失败 · ${error.message}`);
  }
}

async function restoreState() {
  const operation = workspaceOperation;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (typeof payload?.taskTableOpen === 'boolean' && document.getElementById('task-table')) document.getElementById('task-table').open = payload.taskTableOpen;
    if (payload?.overlays) {
      const restoredOverlays = { ...payload.overlays };
      if (typeof restoredOverlays.equator === 'boolean' && typeof restoredOverlays.ecliptic !== 'boolean') {
        restoredOverlays.ecliptic = restoredOverlays.equator;
      }
      state.overlays = { ...state.overlays, ...restoredOverlays, graticule: true };
      for (const [key, input] of Object.entries(els.toggles)) {
        if (input) input.checked = Boolean(state.overlays[key]);
      }
    }
    if (payload?.modulePins && typeof payload.modulePins === 'object') {
      for (const name of DRAWER_MODULES) {
        if (typeof payload.modulePins[name] === 'boolean') state.modulePins[name] = payload.modulePins[name];
      }
    }
    // v2.1 saves kept one active module; its views map onto v2.2 views, drawers only reopen when pinned.
    if (VIEW_MODULES.includes(payload?.activeView)) state.activeView = payload.activeView;
    else if (VIEW_MODULES.includes(payload?.activeModule)) state.activeView = payload.activeModule;
    if (DRAWER_MODULES.has(payload?.activeModule) && state.modulePins[payload.activeModule]) {
      state.activeModule = payload.activeModule;
      state.committedModule = payload.activeModule;
    }
    if (payload?.frame === 'ECI' || payload?.frame === 'ECEF') state.frame = payload.frame;
    if (payload?.centerBody === 'earth') state.centerBody = payload.centerBody;
    if (typeof payload?.simulationStartUtc === 'string') state.simulationStartUtc = payload.simulationStartUtc;
    if (['closed', 'window', 'fullscreen'].includes(payload?.groundTrackPanel)) {
      state.groundTrackPanel = payload.groundTrackPanel;
    }
    if (payload?.groundTrackFilters && typeof payload.groundTrackFilters === 'object') {
      state.groundTrackFilters = { ...payload.groundTrackFilters };
    }
    if (payload?.groundTrackWindow && typeof payload.groundTrackWindow === 'object') {
      const legacyWindow = payload.version !== 2 || typeof payload.groundTrackWindow.timeUnit !== 'string';
      const { futureRevs, futureSeconds, ...restoredWindow } = payload.groundTrackWindow;
      state.groundTrackWindow = {
        ...state.groundTrackWindow,
        ...restoredWindow,
        pastRevs: legacyWindow ? 2 : Math.floor(finitePositiveNumber(restoredWindow.pastRevs, 2)),
        timeUnit: normalizeTimeUnit(restoredWindow.timeUnit),
      };
    }
    if (payload?.groundTrackOptions && typeof payload.groundTrackOptions === 'object') {
      state.groundTrackOptions = { ...state.groundTrackOptions, ...payload.groundTrackOptions };
    }
    if (['power-save', 'balanced', 'high', 'custom'].includes(payload?.performanceMode)) {
      state.performanceMode = payload.performanceMode;
    }
    if (Number.isFinite(Number(payload?.customMemoryGb))) {
      state.customMemoryGb = Number(payload.customMemoryGb);
    }
    if (FRAME_RATE_LIMITS.includes(Number(payload?.frameRateLimit))) state.frameRateLimit = Number(payload.frameRateLimit);
    if (typeof payload?.exportNamePrefix === 'string') state.exportNamePrefix = payload.exportNamePrefix;
    if (typeof payload?.currentAssetId === 'string') state.currentAssetId = payload.currentAssetId;
    if (typeof payload?.isSceneDirty === 'boolean') state.isSceneDirty = payload.isSceneDirty;
    if (['two-body', 'j2', 'j3'].includes(payload?.perturbationModel)) {
      state.perturbationModel = payload.perturbationModel;
    }
    if (Array.isArray(payload?.orbits)) {
      const restored = await buildOrbitRecordsFromSerialized(payload.orbits);
      if (operation !== workspaceOperation) return false;
      state.orbits = restored;
      setSelectedOrbitIds(
        Array.isArray(payload.selectedIds) ? payload.selectedIds : payload.selectedId ? [payload.selectedId] : [],
        { currentId: payload.selectedId, defaultFirst: true },
      );
    }
  } catch (error) {
    console.warn('Failed to restore local orbit state:', error);
    showErrors(`恢复失败，原始存档仍保留：${error.message}`);
    return false;
  }
  return true;
}

async function buildOrbitRecord(rawElements, options = {}) {
  const records = await buildOrbitRecordsFromSerialized([{
    id: options.id ?? uuid(),
    name: rawElements.name?.trim() || `Orbit ${state.orbits.length + 1}`,
    color: normalizeHexColor(options.color, nextOrbitColor(state.orbits.length)),
    visible: options.visible ?? true,
    elements: rawElements,
  }]);
  return records[0];
}

function formToElements() {
  const data = new FormData(els.form);
  return {
    name: String(data.get('name') || '').trim(),
    semiMajorAxisKm: data.get('semiMajorAxisKm'),
    eccentricity: data.get('eccentricity'),
    inclinationDeg: data.get('inclinationDeg'),
    raanDeg: data.get('raanDeg'),
    argPeriapsisDeg: data.get('argPeriapsisDeg'),
    trueAnomalyDeg: data.get('trueAnomalyDeg'),
  };
}

function setColorFields(hex) {
  const normalized = normalizeHexColor(hex);
  const rgb = hexToRgb(normalized);
  els.color.picker.value = normalized;
  els.color.hex.value = normalized;
  els.color.r.value = String(rgb.r);
  els.color.g.value = String(rgb.g);
  els.color.b.value = String(rgb.b);
  els.color.preview.style.backgroundColor = normalized;
  els.color.preview.title = normalized;
  els.color.hexLabel.textContent = normalized.toUpperCase();
  els.color.flyoutSwatch.style.backgroundColor = normalized;
  els.color.flyoutHex.textContent = normalized.toUpperCase();
  markSwatch(normalized);
}

function getFormColor() {
  return normalizeHexColor(els.color.hex.value, nextOrbitColor(state.orbits.length));
}

function setNextFormColor() {
  setColorFields(nextOrbitColor(state.orbits.length));
}

// Add the approved display precision without rounding imported parameters.
function parameterDisplayValue(value, digits) {
  const padded = Number(value).toFixed(digits);
  return Number(padded) === Number(value) ? padded : String(value);
}

// Show a record's values in the dossier without entering edit mode.
function showRecordInForm(record) {
  const elements = record.orbit.elements;
  els.form.elements.name.value = record.name;
  els.form.elements.semiMajorAxisKm.value = elements.semiMajorAxisKm;
  els.form.elements.eccentricity.value = parameterDisplayValue(elements.eccentricity, 3);
  els.form.elements.inclinationDeg.value = parameterDisplayValue(elements.inclinationDeg, 1);
  els.form.elements.raanDeg.value = parameterDisplayValue(elements.raanDeg, 1);
  els.form.elements.argPeriapsisDeg.value = parameterDisplayValue(elements.argPeriapsisDeg, 1);
  els.form.elements.trueAnomalyDeg.value = parameterDisplayValue(elements.trueAnomalyDeg, 1);
  setColorFields(record.color);
  clearErrors();
}

// Enter edit mode: the next submit updates this orbit instead of creating one.
function fillForm(record) {
  showRecordInForm(record);
  state.editingId = record.id;
  els.submitButton.textContent = '更新轨迹';
  els.editName.textContent = record.name;
  els.editBanner.hidden = false;
  els.editBanner.classList.remove('in'); void els.editBanner.offsetWidth; els.editBanner.classList.add('in');
}

function endEdit() {
  state.editingId = null;
  els.submitButton.textContent = '生成轨迹';
  els.editBanner.hidden = true;
}

// Empty inputs show the "-" placeholder, which focus hides (CSS), so typing starts blank.
function blankForm() {
  els.form.reset();
  setNextFormColor();
  clearErrors();
}

// The dossier mirrors the current selection; an edit in progress keeps it locked to its orbit.
let formBoundId;
function syncFormToSelection() {
  const record = selectedOrbitRecord();
  const id = record?.id ?? null;
  if (id === formBoundId) return;
  formBoundId = id;
  if (state.editingId) return;
  if (record) showRecordInForm(record);
  else blankForm();
}

// End any edit and let the next render mirror the selection again.
function resetForm() {
  endEdit();
  blankForm();
  formBoundId = undefined;
}

// Clear button: empty fields that stay empty until the selection changes.
function clearFormInputs() {
  endEdit();
  blankForm();
  formBoundId = selectedOrbitRecord()?.id ?? null;
  renderOrbitList();
}

function cancelEdit() {
  resetForm();
  renderUi();
}

function showErrors(errors) {
  els.formErrors.textContent = Array.isArray(errors) ? errors.join('\n') : String(errors);
  els.formErrors.classList.add('is-visible');
}

function clearErrors() {
  els.formErrors.textContent = '';
  els.formErrors.classList.remove('is-visible');
}

function normalizeSelectedIds(ids = []) {
  const orbitIds = new Set(state.orbits.map((orbit) => orbit.id));
  const normalized = [];
  for (const id of ids) {
    if (orbitIds.has(id) && !normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

function setSelectedOrbitIds(ids = [], { currentId = null, defaultFirst = false } = {}) {
  const normalized = normalizeSelectedIds(ids);
  if (normalized.length === 0 && defaultFirst && state.orbits[0]) normalized.push(state.orbits[0].id);
  state.selectedIds = normalized;
  state.selectedId = currentId && normalized.includes(currentId)
    ? currentId
    : normalized[0] ?? null;
}

function isOrbitSelected(id) {
  return state.selectedIds.includes(id);
}

function selectedOrbitRecord() {
  return state.orbits.find((orbit) => orbit.id === state.selectedId)
    ?? state.orbits.find((orbit) => isOrbitSelected(orbit.id))
    ?? null;
}

function selectOrbit(id) {
  setSelectedOrbitIds([...state.selectedIds, id], { currentId: id });
  renderUi();
  saveState();
}

function toggleOrbitSelection(id) {
  if (!state.orbits.some((orbit) => orbit.id === id)) return false;
  const nextIds = isOrbitSelected(id)
    ? state.selectedIds.filter((selectedId) => selectedId !== id)
    : [...state.selectedIds, id];
  setSelectedOrbitIds(nextIds, { currentId: isOrbitSelected(id) ? null : id });
  renderUi();
  saveState();
  return isOrbitSelected(id);
}

function clearSelectedOrbit() {
  if (state.selectedIds.length === 0) return;
  setSelectedOrbitIds([]);
  resetForm();
  renderUi();
  saveState();
}

function parseRunLimitSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function setRunLimitMenuOpen(isOpen) {
  els.runLimitMenu.hidden = !isOpen;
  els.runLimitToggle.setAttribute('aria-expanded', String(isOpen));
}

function syncRunLimitFromInput() {
  state.runLimitSeconds = parseRunLimitSeconds(els.runDurationLimit.value);
}

function startPlayback() {
  const nowMs = performance.now();
  state.isPlaying = true;
  state.lastFrameMs = nowMs;
  state.runStartedAtMs = nowMs;
  setRunLimitMenuOpen(false);
  renderUi();
}

function pausePlayback() {
  state.isPlaying = false;
  state.runStartedAtMs = null;
  renderUi();
}

function clearGroundTrackHistories(id = null) {
  if (id === null) groundResetToken += 1;
  else groundResetIds.add(id);
  invalidateComputedFrame();
  state.groundTrackTracks = [];
  renderGroundTrackStats();
}

function removeOrbit(id) {
  workspaceOperation += 1;
  state.orbits = state.orbits.filter((orbit) => orbit.id !== id);
  clearGroundTrackHistories(id);
  clearVectorCalibration();
  setSelectedOrbitIds(state.selectedIds.filter((selectedId) => selectedId !== id));
  if (state.editingId === id) resetForm();
  markSceneDirty();
  renderUi();
  saveState();
}

function toggleOrbitVisibility(id) {
  const record = state.orbits.find((orbit) => orbit.id === id);
  if (!record) return;
  record.visible = !record.visible;
  if (!record.visible) clearGroundTrackHistories(id);
  clearVectorCalibration();
  markSceneDirty();
  syncGroundTrackHistories();
  renderUi();
  saveState();
}

function setOverlaysFromInputs({ markDirty = true } = {}) {
  for (const [key, input] of Object.entries(els.toggles)) {
    if (input) state.overlays[key] = input.checked;
  }
  if (markDirty) markSceneDirty();
  scene.setOverlayVisibility(state.overlays);
  saveState();
}

function syncOverlayControlsFromState() {
  for (const [key, input] of Object.entries(els.toggles)) {
    if (input) input.checked = Boolean(state.overlays[key]);
  }
  scene.setOverlayVisibility(state.overlays);
}

function perturbationLabel(value = state.perturbationModel) {
  return {
    'two-body': '无摄动（二体运动）',
    j2: 'J2 摄动',
    j3: 'J3 摄动',
  }[value] ?? '无摄动（二体运动）';
}

function updateStatusSelections() {
  if (!els.bodyOptions.childElementCount) renderBodyOptions();
  const body = bodyById(state.centerBody);
  const shortModel = state.perturbationModel === 'two-body' ? '二体' : state.perturbationModel.toUpperCase();
  els.frameValue.textContent = state.frame;
  els.bodyValue.textContent = `${body.name} · ${shortModel}`;
  els.bodyValue.title = perturbationLabel();
  els.modelSumBody.textContent = body.name;
  els.modelSumBodyNote.textContent = `${body.code} · R ${body.radiusKm} km`;
  els.modelSumModel.textContent = { 'two-body': '二体', j2: 'J2 摄动', j3: 'J3 摄动' }[state.perturbationModel] ?? '二体';
  els.modelSumModelNote.textContent = { 'two-body': '无摄动（二体运动）', j2: '含 J2 项', j3: '含 J2 + J3 项' }[state.perturbationModel] ?? '无摄动（二体运动）';
  // J2 / J3 only exist for bodies that offer them (Earth)
  const models = modelsForBody(body.id);
  for (const option of document.querySelectorAll('#dynamics-flyout [data-perturbation-model]')) option.hidden = !models.includes(option.dataset.perturbationModel);
  els.dynamicsNote.hidden = models.length > 1;
  const mark = (selector, key, value) => {
    for (const button of document.querySelectorAll(selector)) {
      const active = button.dataset[key] === value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
    }
  };
  mark('[data-frame-option]', 'frameOption', state.frame);
  mark('[data-perturbation-model]', 'perturbationModel', state.perturbationModel);
  mark('[data-body-option]', 'bodyOption', state.centerBody);
}

// FRAME / MODEL / ORB menus replace the v2.1 status cards.
function closeStatusCards() {
  closeDropdowns();
}

// MODEL lists the current body and model; a row's side arrow opens its flyout of choices.
function renderBodyOptions() {
  els.bodyOptions.replaceChildren(...BODIES.map((body) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dd-opt status-option body-option';
    button.setAttribute('role', 'menuitemradio');
    button.dataset.bodyOption = body.id;
    button.disabled = !body.available;
    button.innerHTML = `<i></i><b>${escapeHtml(body.name)}</b><small>${escapeHtml(body.available ? `${body.code} · R ${body.radiusKm} km` : `${body.code} · 待后台接入`)}</small>`;
    button.addEventListener('click', () => selectCenterBody(body.id));
    return button;
  }));
}

function modelFlyoutOpen() {
  return els.modelFlyRows.find((row) => row.getAttribute('aria-expanded') === 'true') ?? null;
}

function setModelFlyout(kind, { focus = false } = {}) {
  for (const row of els.modelFlyRows) {
    const on = row.dataset.modelFly === kind;
    const fly = document.getElementById(row.getAttribute('aria-controls'));
    row.setAttribute('aria-expanded', String(on));
    fly.hidden = !on;
    if (!on) continue;
    fly.classList.remove('in'); void fly.offsetWidth; fly.classList.add('in');
    if (focus) (fly.querySelector('[aria-checked="true"]:not([hidden])') ?? fly.querySelector('button:not(:disabled):not([hidden])'))?.focus();
  }
}

// After a choice the flyout folds and the summary row (now showing the new value) keeps focus.
function closeModelFlyout() {
  const row = modelFlyoutOpen();
  setModelFlyout(null);
  row?.focus();
}

function selectCenterBody(id) {
  const body = bodyById(id);
  if (!body.available || body.id !== id) return;
  if (state.centerBody !== id) {
    state.centerBody = id;
    state.perturbationModel = modelForBody(id, state.perturbationModel);
    clearGroundTrackHistories();
    clearVectorCalibration();
    markSceneDirty();
  }
  renderUi();
  closeModelFlyout();
  saveState();
}

function closeInfoModal() {
  els.infoModal.classList.remove('is-open');
}

function isGroundTrackDrawing() {
  return state.activeView === 'groundTrack' && !['closed', 'minimized'].includes(state.groundTrackPanel);
}

// With the WebGL fallback one scene serves both the workbench stage and the ground-track
// viewport; its canvas moves between the two slots.
function placeSceneCanvas() {
  if (!useWebGlScene) return; // the schematic draws each viewport on its own canvas
  const slot = state.activeView === 'groundTrack' ? els.trackCanvasSlot : els.deckCanvasSlot;
  if (slot && els.canvas.parentElement !== slot) {
    slot.append(els.canvas);
    scene.resize();
  }
}

function applyModuleState() {
  const active = state.activeModule;
  els.body.classList.toggle('side-panel-open', DRAWER_MODULES.has(active));
  els.body.classList.toggle('module-previewing', Boolean(state.previewModule));
  els.body.dataset.view = state.activeView;

  for (const view of els.views) view.classList.toggle('on', view.dataset.view === state.activeView);
  for (const button of els.moduleButtons) {
    const moduleName = button.dataset.moduleNav;
    const isView = VIEW_MODULES.includes(moduleName);
    const isCurrent = isView ? moduleName === state.activeView : moduleName === active;
    button.classList.toggle('is-active', isCurrent);
    button.classList.toggle('is-preview', moduleName === state.previewModule);
    if (isView && isCurrent) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    if (!isView) button.setAttribute('aria-expanded', String(isCurrent));
  }

  for (const panel of els.modulePanels) {
    const moduleName = panel.dataset.modulePanel;
    panel.classList.toggle('is-open', moduleName === active);
    panel.classList.toggle('is-pinned', Boolean(state.modulePins[moduleName]));
  }
  // the blurred scrim backs a committed, unpinned drawer or modal; previews and pinned drawers keep the scene live
  els.moduleScrim?.classList.toggle('is-on', Boolean(active) && !state.previewModule && !state.modulePins[active]);

  for (const pinButton of els.modulePinButtons) {
    const moduleName = pinButton.dataset.modulePin;
    const isPinned = Boolean(state.modulePins[moduleName]);
    pinButton.classList.toggle('is-pinned', isPinned);
    pinButton.setAttribute('aria-pressed', String(isPinned));
  }

  els.infoModal.classList.toggle('is-open', active === 'info');
  if (active && active !== lastOpenedModule) moduleEnterEffects(active);
  lastOpenedModule = active;
  placeSceneCanvas();
  applyGroundTrackPanelState();
  refreshListFades();
}

// Opening a drawer or modal decodes its heading (prototype scramble) and, unless it is only a
// hover preview, moves focus to its close button.
let lastOpenedModule = null;
function moduleEnterEffects(moduleName) {
  const surface = moduleName === 'info' ? els.infoModal : els.modulePanels.find((panel) => panel.dataset.modulePanel === moduleName);
  if (!surface) return;
  surface.querySelectorAll('[data-scr]').forEach((el) => scramble(el));
  if (state.previewModule) return;
  setTimeout(() => {
    if (state.activeModule === moduleName && !surface.contains(document.activeElement)) {
      surface.querySelector('[data-module-close], #info-close')?.focus({ preventScroll: true });
    }
  }, 60);
}

function viewEnterEffects(view) {
  if (view === 'groundTrack') {
    syncGroundTrackHistories();
    requestAnimationFrame(() => {
      groundTrackView.resize();
      renderGroundTrack({ force: true });
    });
  }
  if (view === 'console') renderTaskTable(backend);
}

// Switch the persistent view behind a 1.5 s shutter wipe (instant with reduced motion).
function setActiveView(view, { animate = true } = {}) {
  if (!VIEW_MODULES.includes(view)) return;
  if (view === 'groundTrack' && ['closed', 'minimized'].includes(state.groundTrackPanel)) {
    state.groundTrackPanel = 'window';
    syncGroundTrackHistories();
  }
  if (view === state.activeView) {
    applyModuleState();
    viewEnterEffects(view);
    saveState();
    return;
  }
  if (isSwitching()) return;
  setColorFlyout(false);
  closeDropdowns();
  setPlaneViewPop(false);
  hideOrbitTooltip();
  const swap = () => {
    state.activeView = view;
    applyModuleState();
    viewEnterEffects(view);
    dropIn(els.views.find((el) => el.dataset.view === view));
  };
  if (animate) shutter({ label: VIEW_META[view][0], code: VIEW_META[view][1] }, swap);
  else swap();
  saveState();
}

function openModule(moduleName, { preview = false } = {}) {
  if (!moduleName) return;
  if (moduleName !== 'info' && !preview) helpReturn = null;
  clearTimeout(state.hoverPreviewTimer);
  state.hoverPreviewTimer = null;
  if (VIEW_MODULES.includes(moduleName)) {
    setActiveView(moduleName);
    return;
  }
  if (preview) {
    if (!state.previewModule) state.previewReturnModule = state.committedModule;
    state.previewModule = moduleName;
    state.activeModule = moduleName;
  } else {
    state.previewModule = null;
    state.previewReturnModule = null;
    state.activeModule = moduleName;
    state.committedModule = moduleName;
  }
  applyModuleState();
  saveState();
}

function closeActiveModule() {
  if (!state.activeModule) return;
  const back = state.activeModule === 'info' ? helpReturn : null;
  helpReturn = null;
  if (state.activeModule === 'info') closeInfoModal();
  if (back) {
    openModule(back.module);
    setTimeout(() => back.focus?.focus({ preventScroll: true }), 80);
    return;
  }
  state.activeModule = null;
  state.committedModule = null;
  state.previewModule = null;
  state.previewReturnModule = null;
  applyModuleState();
  saveState();
}

function endModulePreview() {
  if (!state.previewModule) return;
  const fallback = state.previewReturnModule;
  state.previewModule = null;
  state.previewReturnModule = null;
  state.activeModule = fallback;
  state.committedModule = fallback;
  applyModuleState();
}

function toggleModulePin(moduleName) {
  if (!DRAWER_MODULES.has(moduleName)) return;
  state.modulePins[moduleName] = !state.modulePins[moduleName];
  if (state.modulePins[moduleName]) {
    state.activeModule = moduleName;
    state.committedModule = moduleName;
    state.previewModule = null;
  }
  applyModuleState();
  saveState();
}

function toggleModuleFromSidebar(moduleName) {
  clearTimeout(state.hoverPreviewTimer);
  state.hoverPreviewTimer = null;
  if (VIEW_MODULES.includes(moduleName)) {
    setActiveView(moduleName);
    return;
  }
  if (state.activeModule === moduleName && !state.previewModule) {
    closeActiveModule();
    return;
  }
  openModule(moduleName);
}

// Hovering a drawer's nav button for two seconds previews that drawer; views never preview.
function startModulePreview(moduleName) {
  clearTimeout(state.hoverPreviewTimer);
  if (!DRAWER_MODULES.has(moduleName)) return;
  state.hoverPreviewTimer = setTimeout(() => {
    if (state.activeModule === moduleName) return;
    openModule(moduleName, { preview: true });
  }, 2000);
}

// PERIOD readout cycles min → h → s on click (min is the default)
const PERIOD_UNITS = [['min', 60, 2], ['h', 3600, 4], ['s', 1, 1]];
let periodUnitIndex = 0;

function orbitCode(record) {
  const index = state.orbits.indexOf(record);
  return String(index + 1).padStart(3, '0');
}

// "SELECTED // ORBIT-001": leading zeros stay slate, significant digits light up cyan
function orbitCodeHtml(code) {
  const zeros = code.match(/^0*(?=\d)/)[0];
  return `ORBIT-${zeros}<span class="sig">${code.slice(zeros.length)}</span>`;
}

// HP / HA / VEL are plain tabular figures: per-digit reels snap to different pixel rows under
// fractional Windows display scaling, which left the digits visibly out of line.
function setFigure(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function setStateVector(current) {
  const values = current
    ? [...['x', 'y', 'z'].map((axis) => formatNumber(current.positionKm[axis], 3)), ...['x', 'y', 'z'].map((axis) => formatNumber(current.velocityKmS[axis], 6))]
    : Array(6).fill('—');
  els.stateVector.forEach((cell, index) => { if (cell.textContent !== values[index]) cell.textContent = values[index]; });
}

function renderMetrics() {
  const selected = selectedOrbitRecord();
  els.selectedOrbitHud.classList.toggle('is-empty', !selected);
  if (!selected) {
    els.selectedOrbitHud.style.setProperty('--c', '#22323A');
    if (els.selectedOrbitName.dataset.text !== '未选择轨道') {
      els.selectedOrbitName.dataset.text = '未选择轨道';
      els.selectedOrbitName.textContent = '未选择轨道';
    }
    els.selectedOrbitName.title = '';
    els.selectedOrbitCode.innerHTML = 'ORBIT-———';
    delete els.selectedOrbitCode.dataset.code;
    els.selectedOrbitMulti.textContent = '';
    els.selectedOrbitClass.hidden = true;
    rollSet(els.selectedOrbitPeriod, '—');
    for (const el of [els.selectedOrbitPeriapsis, els.selectedOrbitApoapsis, els.selectedOrbitSpeed]) setFigure(el, '—');
    els.stateVectorName.textContent = '—';
    setStateVector(null);
    return;
  }

  const orbit = selected.orbit;
  const current = computedStates.get(selected.id);
  els.selectedOrbitHud.style.setProperty('--c', selected.color);
  if (els.selectedOrbitName.dataset.text !== selected.name) {
    els.selectedOrbitName.dataset.text = selected.name;
    els.selectedOrbitName.textContent = selected.name;
    scramble(els.selectedOrbitName, 380);
  }
  els.selectedOrbitName.title = state.selectedIds.length > 1
    ? `当前查看 ${selected.name}，已选 ${state.selectedIds.length} 条轨道`
    : selected.name;
  const code = orbitCode(selected);
  if (els.selectedOrbitCode.dataset.code !== code) {
    els.selectedOrbitCode.dataset.code = code;
    els.selectedOrbitCode.innerHTML = orbitCodeHtml(code);
  }
  els.selectedOrbitMulti.textContent = state.selectedIds.length > 1 ? `+${state.selectedIds.length - 1} MULTI` : '';
  const kind = classifyOrbitRecord(selected);
  els.selectedOrbitClass.hidden = !kind;
  if (kind) {
    els.selectedOrbitClass.textContent = kind.toUpperCase();
    els.selectedOrbitClass.title = ORBIT_CLASSES[kind].zh;
    els.selectedOrbitClass.style.setProperty('--k', ORBIT_CLASSES[kind].accent);
  }
  const [unit, divisor, digits] = PERIOD_UNITS[periodUnitIndex];
  rollSet(els.selectedOrbitPeriod, Number.isFinite(orbit.periodSeconds) ? (orbit.periodSeconds / divisor).toFixed(digits) : '—');
  els.selectedOrbitPeriodUnit.textContent = unit;
  els.selectedOrbitPeriodCell.title = `${formatDuration(orbit.periodSeconds)} · 点击切换单位 min / h / s`;
  setFigure(els.selectedOrbitPeriapsis, formatNumber(orbit.periapsisAltitudeKm, 1));
  setFigure(els.selectedOrbitApoapsis, formatNumber(orbit.apoapsisAltitudeKm, 1));
  setFigure(els.selectedOrbitSpeed, `${formatNumber(orbit.speedRangeKmS.min, 3)}–${formatNumber(orbit.speedRangeKmS.max, 3)}`);
  els.stateVectorName.textContent = current ? selected.name : `${selected.name} · 等待后台`;
  setStateVector(current);
}

function cyclePeriodUnit() {
  periodUnitIndex = (periodUnitIndex + 1) % PERIOD_UNITS.length;
  els.selectedOrbitPeriod._shape = null;
  delete els.selectedOrbitPeriod.dataset.roll;
  renderMetrics();
}

function calibrationModeLabel(mode = 'position') {
  return mode === 'velocity' ? '速度矢量标定' : '位置矢量标定';
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

function updateCalibrationDraftTarget(field, value) {
  const draft = state.calibrationDraftTarget;
  if (field === 'name') {
    draft.name = value;
  } else if (field === 'mode') {
    draft.mode = value === 'velocity' ? 'velocity' : 'position';
    renderCalibrationEditor();
  } else if (field === 'x' || field === 'y' || field === 'z') {
    draft.vector[field] = value;
  }
  if (state.calibrationEditorError) {
    state.calibrationEditorError = '';
    renderCalibrationEditorError();
  }
}

function renderCalibrationEditorError() {
  els.calibrationEditorError.textContent = state.calibrationEditorError;
  els.calibrationEditorError.classList.toggle('is-visible', Boolean(state.calibrationEditorError));
}

function resetCalibrationDraft() {
  state.calibrationDraftTarget = createCalibrationDraftTarget();
  state.calibrationEditingTargetId = null;
  state.calibrationEditorError = '';
}

function normalizeCalibrationDraftTarget() {
  const draft = state.calibrationDraftTarget;
  const name = String(draft.name ?? '').trim();
  if (!name) throw new Error('请填写标定点名称。');
  parseCalibrationVector(draft.vector);
  return {
    name,
    mode: draft.mode === 'velocity' ? 'velocity' : 'position',
    vector: {
      x: draft.vector.x,
      y: draft.vector.y,
      z: draft.vector.z,
    },
  };
}

function clearSolvedCalibrationState() {
  calibrationOperation += 1;
  state.calibrationResult = null;
  state.calibrationExpandedTargetIds.clear();
  scene.setCalibrationMarkers([]);
}

function addOrSaveCalibrationTarget() {
  let normalized;
  try {
    normalized = normalizeCalibrationDraftTarget();
  } catch (error) {
    state.calibrationEditorError = error.message || '标定点输入无效。';
    renderCalibrationEditorError();
    return;
  }

  if (state.calibrationEditingTargetId) {
    state.calibrationTargets = state.calibrationTargets.map((target) => (
      target.id === state.calibrationEditingTargetId
        ? { ...target, ...normalized }
        : target
    ));
  } else {
    state.calibrationTargets.push(createCalibrationTarget(normalized));
  }

  clearSolvedCalibrationState();
  resetCalibrationDraft();
  renderCalibrationEditor();
  renderCalibrationTargets();
  renderCalibrationResults();
}

function addCalibrationTarget() {
  addOrSaveCalibrationTarget();
}

function editCalibrationTarget(targetId) {
  const target = findCalibrationTarget(targetId);
  if (!target) return;
  state.calibrationDraftTarget = cloneCalibrationTarget(target);
  state.calibrationEditingTargetId = targetId;
  state.calibrationEditorError = '';
  renderCalibrationEditor();
}

function cancelCalibrationTargetEdit() {
  resetCalibrationDraft();
  renderCalibrationEditor();
}

function deleteCalibrationTarget(targetId) {
  calibrationOperation += 1;
  state.calibrationTargets = state.calibrationTargets.filter((target) => target.id !== targetId);
  state.calibrationExpandedTargetIds.delete(targetId);
  state.hiddenCalibrationTargetIds.delete(targetId);
  if (state.calibrationEditingTargetId === targetId) resetCalibrationDraft();
  if (state.calibrationResult?.targets) {
    const targets = state.calibrationResult.targets.filter((targetResult) => targetResult.targetId !== targetId);
    state.calibrationResult = {
      ...state.calibrationResult,
      status: targets.length > 0 ? state.calibrationResult.status : 'no-valid-targets',
      targets,
      hits: state.calibrationResult.hits.filter((hit) => hit.targetId !== targetId),
    };
  }
  refreshCalibrationMarkers();
  renderCalibrationEditor();
  renderCalibrationTargets();
  renderCalibrationResults();
}

function renderCalibrationEditor() {
  const target = state.calibrationDraftTarget;
  const isEditing = Boolean(state.calibrationEditingTargetId);
  els.calibrationAddTarget.textContent = isEditing ? '保存修改' : '添加至标定列表';
  els.calibrationCancelEdit.hidden = !isEditing;
  els.calibrationTargetEditor.innerHTML = `
    <article class="calibration-target-row calibration-editor-row">
      <div class="calibration-target-fields">
        <div class="calibration-target-topline">
          <label>
            <span>名称</span>
            <input type="text" value="${escapeHtml(target.name)}" data-calibration-draft-field="name" autocomplete="off" />
          </label>
          <label>
            <span>类型</span>
            <select data-calibration-draft-field="mode">
              <option value="position"${target.mode === 'position' ? ' selected' : ''}>位置矢量</option>
              <option value="velocity"${target.mode === 'velocity' ? ' selected' : ''}>速度矢量</option>
            </select>
          </label>
        </div>
        ${['x', 'y', 'z'].map((axis) => `
          <label class="calibration-vector-line">
            <span class="calibration-vector-axis">${axis}</span>
            <input type="number" step="any" inputmode="decimal" value="${escapeHtml(target.vector[axis])}" data-calibration-draft-field="${axis}" autocomplete="off" />
            <span class="calibration-vector-unit">${calibrationVectorUnit(target.mode)}</span>
          </label>
        `).join('')}
      </div>
    </article>
  `;
  renderCalibrationEditorError();
}

function formatCalibrationVector(vector, digits = 4) {
  if (!vector) return '--';
  return `(${formatNumber(vector.x, digits)}, ${formatNumber(vector.y, digits)}, ${formatNumber(vector.z, digits)})`;
}

function calibrationTargetVectorLabel(target) {
  return `${formatCalibrationVector(target.vector, target.mode === 'velocity' ? 6 : 3)} ${calibrationVectorUnit(target.mode)}`;
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

function calibrationResultSummary(targetResult) {
  if (!targetResult) return '待标定';
  const result = targetResult.result;
  if (result.status === 'input-error') return result.error;
  if (result.status === 'no-visible-orbits') return '暂无可标定轨道';
  if (result.status === 'no-valid-states') return '无有效轨道状态';
  if (result.hits.length === 0) return '无精确解';
  return `命中 ${result.hits.length} 个点`;
}

function calibrationTargetResult(targetId) {
  return state.calibrationResult?.targets?.find((targetResult) => targetResult.targetId === targetId) ?? null;
}

function calibrationSeriesDetailHtml(target, targetResult) {
  if (!targetResult) {
    return `<div class="calibration-target-vector">目标矢量：${escapeHtml(calibrationTargetVectorLabel(target))}</div>`;
  }
  const result = targetResult.result;
  const targetVector = result.targetVector;
  const vectorLabel = targetVector
    ? `${formatCalibrationVector(targetVector, targetResult.mode === 'velocity' ? 6 : 3)} ${calibrationVectorUnit(targetResult.mode)}`
    : '--';

  if (result.status === 'input-error') {
    return `<div class="empty-list">${escapeHtml(result.error)}</div>`;
  }

  if (result.status === 'no-visible-orbits') {
    return '<div class="empty-list">暂无可标定轨道。</div>';
  }

  if (result.status === 'no-valid-states') {
    return '<div class="empty-list">无有效轨道状态。</div>';
  }

  if (result.hits.length === 0) {
    return `
      <div class="calibration-target-vector">目标矢量：${escapeHtml(vectorLabel)}</div>
      <div class="calibration-series-detail-list">
        <div class="calibration-result-summary">无精确解</div>
        ${result.nearest ? calibrationResultItemHtml(result.nearest, result.mode, true) : ''}
      </div>
    `;
  }

  return `
    <div class="calibration-target-vector">目标矢量：${escapeHtml(vectorLabel)}</div>
    <div class="calibration-series-detail-list">
      ${result.hits.map((hit) => calibrationResultItemHtml(hit, result.mode)).join('')}
    </div>
  `;
}

function calibrationSeriesItemHtml(target) {
  const targetId = target.id;
  const targetResult = calibrationTargetResult(targetId);
  const result = targetResult?.result ?? null;
  const isExpanded = state.calibrationExpandedTargetIds.has(targetId);
  const isHidden = state.hiddenCalibrationTargetIds.has(targetId);
  const tone = result?.status === 'input-error'
    ? ' is-error'
    : result && result.hits.length === 0
      ? ' is-empty'
      : '';

  return `
    <article class="calibration-series-item${isExpanded ? ' is-open' : ''}${isHidden ? ' is-hidden' : ''}${tone}" data-calibration-result-target="${escapeHtml(targetId)}">
      <button class="calibration-series-main" type="button" data-calibration-toggle-result="${escapeHtml(targetId)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <strong>${escapeHtml(target.name)}</strong>
        <span>${escapeHtml(calibrationModeLabel(target.mode))} · ${escapeHtml(calibrationResultSummary(targetResult))}</span>
      </button>
      <div class="calibration-series-actions">
        <button class="mini-button" type="button" data-calibration-target-visibility="${escapeHtml(targetId)}" title="${isHidden ? '显示该系列标定点' : '隐藏该系列标定点'}" aria-pressed="${isHidden ? 'true' : 'false'}">${isHidden ? '○' : '●'}</button>
        <button class="mini-button" type="button" data-calibration-edit-target="${escapeHtml(targetId)}" title="编辑标定点">✎</button>
        <button class="mini-button" type="button" data-calibration-delete-target="${escapeHtml(targetId)}" title="删除标定点">×</button>
      </div>
      ${isExpanded ? `<div class="calibration-series-detail">${calibrationSeriesDetailHtml(target, targetResult)}</div>` : ''}
    </article>
  `;
}

function renderCalibrationTargets() {
  els.calibrationTargetCount.textContent = `${state.calibrationTargets.length} 条`;
  if (state.calibrationTargets.length === 0) {
    els.calibrationTargetList.innerHTML = '<div class="empty-list">当前没有标定点。填写上方输入后添加至列表。</div>';
    return;
  }
  els.calibrationTargetList.innerHTML = `<div class="calibration-series-list">${state.calibrationTargets.map((target) => calibrationSeriesItemHtml(target)).join('')}</div>`;
}

function renderCalibrationResults() {
  const result = state.calibrationResult;
  if (state.calibrationTargets.length === 0) {
    els.calibrationResults.textContent = '添加标定点后点击标定全部。';
    return;
  }
  if (!result) {
    els.calibrationResults.textContent = `列表中 ${state.calibrationTargets.length} 个标定点，点击标定全部。`;
    return;
  }

  if (result.status === 'no-valid-targets' && result.targets.length === 0) {
    els.calibrationResults.textContent = '暂无可标定矢量。';
    return;
  }

  els.calibrationResults.textContent = `标定完成：命中 ${result.hits.length} 个点。`;
}

function refreshCalibrationMarkers() {
  scene.setCalibrationMarkers(calibrationMarkersFromBatchResult(state.calibrationResult));
}

function toggleCalibrationResultExpansion(targetId) {
  if (state.calibrationExpandedTargetIds.has(targetId)) {
    state.calibrationExpandedTargetIds.delete(targetId);
  } else {
    state.calibrationExpandedTargetIds.add(targetId);
  }
  renderCalibrationTargets();
}

function toggleCalibrationTargetVisibility(targetId) {
  if (state.hiddenCalibrationTargetIds.has(targetId)) {
    state.hiddenCalibrationTargetIds.delete(targetId);
  } else {
    state.hiddenCalibrationTargetIds.add(targetId);
  }
  refreshCalibrationMarkers();
  renderCalibrationTargets();
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
      velocityKmS: hit.velocityKmS,
      residual: hit.residual,
      elapsedSeconds: hit.elapsedSeconds,
      perturbationModel: hit.perturbationModel,
      visible: !state.hiddenCalibrationTargetIds.has(targetResult.targetId),
    }))
  ));
}

async function runVectorCalibration() {
  const targetIds = new Set(state.calibrationTargets.map((target) => target.id));
  state.calibrationExpandedTargetIds = new Set([...state.calibrationExpandedTargetIds].filter((targetId) => targetIds.has(targetId)));
  state.hiddenCalibrationTargetIds = new Set([...state.hiddenCalibrationTargetIds].filter((targetId) => targetIds.has(targetId)));
  const budget = currentGroundTrackBudget();
  const version = ++calibrationOperation;
  els.calibrationSubmitAll.disabled = true;
  try {
    const result = await backend.run('calibration', {
      records: state.orbits.map(serializeOrbit),
      targets: state.calibrationTargets,
      perturbationModel: state.perturbationModel,
      sampleCount: budget.max3dReferenceSamples,
    }, `矢量标定 · ${state.calibrationTargets.length} 个目标`);
    if (version !== calibrationOperation) return;
    state.calibrationResult = result;
    refreshCalibrationMarkers();
    renderCalibrationTargets();
    renderCalibrationResults();
  } catch (error) { showErrors(error.message); }
  finally { els.calibrationSubmitAll.disabled = false; }
}

function clearVectorCalibration() {
  calibrationOperation += 1;
  state.calibrationResult = null;
  state.calibrationExpandedTargetIds.clear();
  state.hiddenCalibrationTargetIds.clear();
  scene.setCalibrationMarkers([]);
  renderCalibrationTargets();
  renderCalibrationResults();
}

const ICONS = {
  eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><path d="M2.5 13.5l11-11"/>',
  edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
  editOff: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M1.8 1.8l12.4 12.4"/>',
  trash: '<path d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9"/>',
  check: '<path d="M3 8.5L6.5 12 13 4"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;

function iconButton(className, name, label, onClick, pressed = null) {
  const button = document.createElement('button');
  button.className = `ib ${className}`.trim();
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  if (pressed !== null) button.setAttribute('aria-pressed', String(pressed));
  button.innerHTML = icon(name);
  button.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
  return button;
}

// Pencil toggles edit mode: a second click on the orbit being edited cancels the edit.
function toggleOrbitEdit(record) {
  if (state.editingId === record.id) {
    cancelEdit();
    return;
  }
  const enter = () => {
    selectOrbit(record.id);
    fillForm(record);
    renderOrbitList();
    els.form.elements.name.focus({ preventScroll: true });
  };
  if (state.activeView !== 'workbench') {
    setActiveView('workbench');
    setTimeout(enter, RM.matches ? 0 : VIEW_MS + 60);
  } else enter();
}

// Roster card: colour spine, select box, name, class badge + status tag, actions. Both rosters
// (workbench dossier and ground-track view) render the same cards from the same state.
function orbitCard(record, list) {
  const item = document.createElement('div');
  const isSelected = isOrbitSelected(record.id);
  const isMuted = state.selectedIds.length > 0 && !isSelected;
  const isEditing = state.editingId === record.id;
  item.className = `card orbit-item${isSelected ? ' sel is-selected' : ''}${isMuted ? ' is-muted' : ''}${record.visible ? '' : ' off is-hidden-orbit'}`;
  item.setAttribute('role', 'listitem');
  item.style.setProperty('--c', record.color);
  item.style.setProperty('--orbit-color', record.color);
  item.dataset.orbitId = record.id;

  const toggleSelection = () => { toggleOrbitSelection(record.id); };

  const selection = document.createElement('input');
  selection.className = 'orbit-select ck';
  selection.type = 'checkbox';
  selection.checked = isSelected;
  selection.setAttribute('aria-label', `选择轨道 ${record.name}`);
  selection.addEventListener('click', (event) => event.stopPropagation());
  selection.addEventListener('change', () => {
    toggleSelection();
    // Rendering replaces the row; retain keyboard focus for multi-selection.
    list.querySelector(`[data-orbit-id="${CSS.escape(record.id)}"] .orbit-select`)?.focus({ preventScroll: true });
  });

  const main = document.createElement('button');
  main.className = 'orbit-main nm';
  main.type = 'button';
  main.setAttribute('aria-pressed', String(isSelected));
  main.innerHTML = `<span>${escapeHtml(record.name)}</span>`;
  main.addEventListener('click', toggleSelection);

  const meta = document.createElement('div');
  meta.className = 'cls';
  const kind = classifyOrbitRecord(record);
  if (kind) {
    const badge = document.createElement('span');
    badge.className = 'ocls';
    badge.style.setProperty('--k', ORBIT_CLASSES[kind].accent);
    badge.title = ORBIT_CLASSES[kind].zh;
    badge.textContent = kind.toUpperCase();
    meta.append(badge);
  }
  if (isEditing || isSelected) {
    const tag = document.createElement('span');
    tag.className = `stag${isEditing ? ' rev' : ''}`;
    tag.dataset.i18nSkip = '';
    tag.textContent = isEditing ? '/// REVISED' : '/// SELECTED';
    meta.append(tag);
  }

  const actions = document.createElement('div');
  actions.className = 'acts orbit-actions';
  actions.append(
    iconButton('', record.visible ? 'eye' : 'eyeOff', `${record.visible ? '隐藏轨道' : '显示轨道'} ${record.name}`, () => toggleOrbitVisibility(record.id), !record.visible),
    iconButton(isEditing ? 'on' : '', isEditing ? 'editOff' : 'edit', isEditing ? `取消编辑 ${record.name}` : `编辑参数 ${record.name}`, () => toggleOrbitEdit(record), isEditing),
    iconButton('del delete-orbit', 'trash', `删除轨道 ${record.name}`, () => removeOrbit(record.id)),
  );
  item.addEventListener('click', (event) => { if (event.target === item) toggleSelection(); });
  item.append(selection, main, meta, actions);
  return item;
}

function renderOrbitList() {
  for (const list of els.orbitLists) {
    list.innerHTML = '';
    if (state.orbits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-list empty';
      empty.textContent = '当前没有轨道。填写六要素后生成第一条轨迹。';
      list.append(empty);
      continue;
    }
    for (const record of pageRecords(list, state.orbits, renderOrbitList)) list.append(orbitCard(record, list));
  }
  renderRosterMeta();
  refreshListFades();
}

// Header count and footer status (orbit group + visible / selected) for both rosters.
function renderRosterMeta() {
  const count = String(state.orbits.length).padStart(2, '0');
  for (const el of document.querySelectorAll('.js-rcount')) rollSet(el, count);
  const meta = `VIS ${state.orbits.filter((orbit) => orbit.visible).length} · SEL ${state.selectedIds.length}`;
  for (const el of document.querySelectorAll('.js-rmeta')) el.textContent = meta;
  const group = activeAssetGroup();
  const label = `轨道组 <b>${escapeHtml(group?.name ?? '未命名')}</b>${state.isSceneDirty ? ' · <span class="dirty">● 未保存</span>' : ''}`;
  for (const el of document.querySelectorAll('.js-grp')) el.innerHTML = label;
}

function renderStatusOrbitMenu() {
  els.statusOrbitMenu.innerHTML = '';
  const visibleOrbits = state.orbits.filter((orbit) => orbit.visible);
  if (visibleOrbits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '暂无显示轨道';
    els.statusOrbitMenu.append(empty);
    return;
  }

  for (const record of pageRecords(els.statusOrbitMenu, visibleOrbits, renderStatusOrbitMenu)) {
    const button = document.createElement('button');
    button.className = `status-option status-orbit-choice${isOrbitSelected(record.id) ? ' is-active' : ''}`;
    button.type = 'button';
    button.dataset.statusOrbitId = record.id;

    button.classList.add('dd-opt');
    button.setAttribute('role', 'menuitemcheckbox');
    button.setAttribute('aria-checked', String(isOrbitSelected(record.id)));
    button.style.setProperty('--c', record.color);
    const dot = document.createElement('i');
    dot.className = 'color-dot';
    const name = document.createElement('b');
    name.textContent = record.name;

    button.append(dot, name);
    button.addEventListener('click', () => {
      toggleOrbitSelection(record.id);
    });
    els.statusOrbitMenu.append(button);
  }
}

function orbitTooltipHtml(record) {
  const elements = record.orbit.elements;
  const rows = [
    ['轨道半长轴 a', `${formatNumber(elements.semiMajorAxisKm, 6)} km`],
    ['偏心率 e', formatNumber(elements.eccentricity, 10)],
    ['轨道倾角 i', `${formatNumber(elements.inclinationDeg, 6)} °`],
    ['升交点赤经 Ω', `${formatNumber(elements.raanDeg, 6)} °`],
    ['近地点幅角 ω', `${formatNumber(elements.argPeriapsisDeg, 6)} °`],
    ['真近点角 ν', `${formatNumber(elements.trueAnomalyDeg, 6)} °`],
  ];
  return `
    <strong>${escapeHtml(record.name)}</strong>
    <dl>
      ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
    </dl>
  `;
}

function calibrationTooltipHtml(marker) {
  const rows = [
    ['类型', calibrationModeLabel(marker.targetMode)],
    ['轨道', marker.orbitName],
    ['仿真时刻', `${formatNumber(marker.elapsedSeconds, 3)} s`],
    ['ECI 位置', `${formatCalibrationVector(marker.positionKm, 3)} km`],
    ['ECI 速度', `${formatCalibrationVector(marker.velocityKmS, 5)} km/s`],
    ['残差', `${formatNumber(marker.residual, marker.targetMode === 'velocity' ? 8 : 5)} ${calibrationResidualUnit(marker.targetMode)}`],
    ['动力学', marker.perturbationModel ?? '--'],
  ];
  return `
    <span class="tt-k" data-i18n-skip>CALIB // TARGET</span>
    <strong>${escapeHtml(marker.targetName)}</strong>
    <dl>
      ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
    </dl>
  `;
}

function hideOrbitTooltip() {
  els.orbitTooltip.hidden = true;
}

// Hovering an orbit shows its six elements; a calibration hit or imported trajectory shows its own details.
function showOrbitTooltip(payload) {
  if (state.activeView !== 'workbench') payload = null;
  const marker = payload?.calibrationMarker ?? null;
  const trajectory = payload?.trajectory ?? null;
  if (!payload?.orbitRecord && !marker && !trajectory) {
    els.orbitTooltip.hidden = true;
    return;
  }
  const { orbitRecord, clientX, clientY } = payload;
  els.orbitTooltip.innerHTML = marker ? calibrationTooltipHtml(marker) : trajectory ? trajectoryTooltipHtml(trajectory) : orbitTooltipHtml(orbitRecord);
  els.orbitTooltip.style.setProperty('--orbit-tooltip-color', (marker ?? trajectory ?? orbitRecord).color);
  els.orbitTooltip.hidden = false;

  const margin = 16;
  const rect = els.orbitTooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - margin, clientX + 18);
  const top = Math.min(window.innerHeight - rect.height - margin, clientY + 18);
  els.orbitTooltip.style.left = `${Math.max(margin, left)}px`;
  els.orbitTooltip.style.top = `${Math.max(margin, top)}px`;
}

/* ---------- orbit-plane view: look down the plane given by inclination and RAAN ---------- */
function planeViewOpen() {
  return !els.planeViewPop.hidden;
}

// The tools plate is clipped, so the popover lives on the stage and is placed over the VIEW
// button. Layout offsets (not client rects) ignore the plate's slide-in transform.
function placePlaneViewPop() {
  const stage = els.planeViewPop.parentElement;
  let left = 0;
  for (let node = els.planeViewToggle; node && node !== stage; node = node.offsetParent) left += node.offsetLeft;
  const maxLeft = stage.clientWidth - els.planeViewPop.offsetWidth - 12;
  els.planeViewPop.style.left = `${Math.max(12, Math.min(left, maxLeft))}px`;
  els.planeViewPop.style.bottom = `${stage.clientHeight - els.toolsPanel.offsetTop + 8}px`;
}

function setPlaneViewPop(open, { focus = false } = {}) {
  if (open === planeViewOpen()) return;
  els.planeViewToggle.setAttribute('aria-expanded', String(open));
  els.planeViewPop.hidden = !open;
  if (!open) return;
  closeDropdowns();
  if (els.toolsPanel.classList.contains('away')) document.getElementById('tools-tab').click();
  els.planeViewFromOrbit.disabled = !selectedOrbitRecord();
  placePlaneViewPop();
  els.planeViewPop.classList.remove('in'); void els.planeViewPop.offsetWidth; els.planeViewPop.classList.add('in');
  if (focus) els.planeViewInc.focus({ preventScroll: true });
}

function showPlaneViewError(message = '', field = null) {
  els.planeViewError.textContent = message;
  els.planeViewError.classList.toggle('is-visible', Boolean(message));
  for (const input of [els.planeViewInc, els.planeViewRaan]) input.closest('.pp-f').classList.toggle('bad', input === field);
}

function applyPlaneView(event) {
  event?.preventDefault();
  const inclination = els.planeViewInc.value.trim() === '' ? NaN : Number(els.planeViewInc.value);
  const raan = els.planeViewRaan.value.trim() === '' ? NaN : Number(els.planeViewRaan.value);
  if (!Number.isFinite(inclination) || inclination < 0 || inclination > 180) {
    showPlaneViewError('轨道倾角需在 0–180° 之间。', els.planeViewInc);
    return;
  }
  if (!Number.isFinite(raan)) {
    showPlaneViewError('请输入有效的升交点赤经。', els.planeViewRaan);
    return;
  }
  showPlaneViewError();
  scene.setPlaneView(inclination, raan);
}

function planeViewFromSelectedOrbit() {
  const elements = selectedOrbitRecord()?.orbit?.elements;
  if (!elements) return;
  els.planeViewInc.value = String(Number(elements.inclinationDeg.toFixed(6)));
  els.planeViewRaan.value = String(Number(elements.raanDeg.toFixed(6)));
  applyPlaneView();
}

function currentGroundTrackBudget() {
  const budget = groundTrackBudget({
    mode: state.performanceMode,
    memoryGb: state.customMemoryGb,
  });
  scene.setPerformanceBudget?.(budget);
  return budget;
}

function syncGroundTrackControlsFromState() {
  if (!state.simulationStartUtc) state.simulationStartUtc = utcDatetimeLocalValue(new Date());
  state.groundTrackWindow.timeUnit = normalizeTimeUnit(state.groundTrackWindow.timeUnit);
  els.simulationStartUtc.value = state.simulationStartUtc;
  els.groundTrackWindowMode.value = state.groundTrackWindow.mode;
  els.groundTrackPastRevs.value = String(state.groundTrackWindow.pastRevs);
  els.groundTrackRetentionTime.value = groundTrackTimeValue(
    state.groundTrackWindow.pastSeconds,
    state.groundTrackWindow.timeUnit,
  );
  els.groundTrackRetentionUnit.value = state.groundTrackWindow.timeUnit;
  const timeMode = state.groundTrackWindow.mode === 'time';
  els.groundTrackPastRevs.closest('label').hidden = timeMode;
  els.groundTrackRetentionTime.closest('label').hidden = !timeMode;
  els.groundTrackRetentionUnit.closest('label').hidden = !timeMode;
  els.performanceMode.value = state.performanceMode;
  els.customMemory.value = String(state.customMemoryGb);
}

function syncGroundTrackWindowFromControls() {
  const timeUnit = normalizeTimeUnit(els.groundTrackRetentionUnit.value);
  state.groundTrackWindow = {
    mode: els.groundTrackWindowMode.value === 'time' ? 'time' : 'revs',
    pastRevs: Math.floor(finitePositiveNumber(els.groundTrackPastRevs.value, 2)),
    pastSeconds: finitePositiveNumber(els.groundTrackRetentionTime.value, 60) * TIME_UNIT_SECONDS[timeUnit],
    timeUnit,
  };
}

function syncPerformanceFromControls() {
  state.performanceMode = ['power-save', 'balanced', 'high', 'custom'].includes(els.performanceMode.value)
    ? els.performanceMode.value
    : 'high';
  state.customMemoryGb = Math.max(1, Math.min(24, Number(els.customMemory.value) || 8));
  currentGroundTrackBudget();
  renderSettingsReadouts();
}

const PERFORMANCE_HINTS = {
  'power-save': '节能：星下点每圈 96 采样，三维参考轨道 ≤ 900 点，适合笔记本电池供电。',
  balanced: '均衡：星下点每圈 160 采样，三维参考轨道 ≤ 1800 点。',
  high: '高性能：星下点每圈 240 采样，三维参考轨道 ≤ 3600 点（默认）。',
  custom: '自定义：按下方显存预算缩放采样上限。',
};

// Settings readouts: preset hint, memory gauge (dimmed unless the custom preset uses it), frame rate.
function renderSettingsReadouts() {
  if (els.performanceHint) els.performanceHint.textContent = PERFORMANCE_HINTS[state.performanceMode] ?? '';
  const memory = Math.round(state.customMemoryGb);
  if (els.customMemoryValue) els.customMemoryValue.textContent = `${memory} GB`;
  if (els.customMemoryGrid) {
    if (els.customMemoryGrid.childElementCount !== 24) els.customMemoryGrid.innerHTML = '<i></i>'.repeat(24);
    [...els.customMemoryGrid.children].forEach((cell, index) => cell.classList.toggle('on', index < memory));
    els.customMemoryGrid.classList.toggle('is-idle', state.performanceMode !== 'custom');
  }
  if (els.frameRateValue) els.frameRateValue.textContent = state.frameRateLimit > 0 ? `${state.frameRateLimit} FPS` : 'MAX';
  syncSegmentedSelects();
}

function syncSettingsControls() {
  els.performanceMode.value = state.performanceMode;
  els.customMemory.value = String(state.customMemoryGb);
  els.frameRateLimit.value = String(state.frameRateLimit);
  els.exportNamePrefix.value = state.exportNamePrefix;
  renderSettingsReadouts();
}

function syncGroundTrackOptionControls() {
  els.groundTrackHighlightLongitude.checked = Boolean(state.groundTrackOptions.highlightLongitude);
  els.groundTrackHighlightLatitude.checked = Boolean(state.groundTrackOptions.highlightLatitude);
  els.groundTrackHighlightEquator.checked = Boolean(state.groundTrackOptions.highlightEquator);
  els.groundTrackCursorGuides.checked = Boolean(state.groundTrackOptions.cursorGuides);
  groundTrackView.setOptions(state.groundTrackOptions);
}

function syncGroundTrackOptionsFromControls() {
  state.groundTrackOptions = {
    highlightLongitude: els.groundTrackHighlightLongitude.checked,
    highlightLatitude: els.groundTrackHighlightLatitude.checked,
    highlightEquator: els.groundTrackHighlightEquator.checked,
    cursorGuides: els.groundTrackCursorGuides.checked,
  };
  groundTrackView.setOptions(state.groundTrackOptions);
}

function syncGroundTrackFilters() {
  const visibleIds = new Set(state.orbits.filter((orbit) => orbit.visible).map((orbit) => orbit.id));
  for (const id of Object.keys(state.groundTrackFilters)) {
    if (!visibleIds.has(id)) delete state.groundTrackFilters[id];
  }
  for (const id of visibleIds) {
    if (typeof state.groundTrackFilters[id] !== 'boolean') state.groundTrackFilters[id] = false;
  }
}

function renderGroundTrackFilters() {
  syncGroundTrackFilters();
  updateGroundTrackCount();
  els.groundTrackFilterList.innerHTML = '';
  const visibleOrbits = state.orbits.filter((orbit) => orbit.visible);
  if (visibleOrbits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '暂无可见轨道';
    els.groundTrackFilterList.append(empty);
    return;
  }

  for (const record of pageRecords(els.groundTrackFilterList, visibleOrbits, renderGroundTrackFilters)) {
    const label = document.createElement('label');
    label.className = 'ground-track-filter-row tchip';
    label.style.setProperty('--c', record.color);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.groundTrackFilters[record.id] !== false;
    input.dataset.groundTrackFilter = record.id;

    const name = document.createElement('span');
    name.textContent = record.name;

    const swatch = document.createElement('i');
    swatch.className = 'ground-track-color-swatch';

    input.addEventListener('change', () => {
      state.groundTrackFilters[record.id] = input.checked;
      updateGroundTrackCount();
      if (!input.checked) clearGroundTrackHistories(record.id);
      markSceneDirty();
      syncGroundTrackHistories();
      renderGroundTrack({ force: true });
      saveState();
    });

    label.append(input, swatch, name);
    els.groundTrackFilterList.append(label);
  }
  updateGroundTrackCount();
}

function updateGroundTrackCount() {
  if (!els.groundTrackCount) return;
  els.groundTrackCount.textContent = String(state.orbits.filter((orbit) => orbit.visible && state.groundTrackFilters[orbit.id] === true).length);
}

function currentGroundTrackWindow() {
  return state.groundTrackWindow.mode === 'time'
    ? {
      mode: 'time',
      pastSeconds: state.groundTrackWindow.pastSeconds,
    }
    : {
      mode: 'revs',
      pastRevs: state.groundTrackWindow.pastRevs,
    };
}

function activeGroundTrackRecords(budget) {
  syncGroundTrackFilters();
  return state.orbits
    .filter((orbit) => orbit.visible && state.groundTrackFilters[orbit.id] !== false)
    .slice(0, budget.mapCacheTracks);
}

function rebuildGroundTrackTracksFromCache(records = null) {
  const activeIds = new Set((records ?? activeGroundTrackRecords(currentGroundTrackBudget())).map((record) => record.id));
  state.groundTrackTracks = state.groundTrackTracks.filter((track) => activeIds.has(track.id));
  return state.groundTrackTracks;
}

function syncGroundTrackHistories() {
  frameDirty = true;
  frameRevision += 1;
  if (state.groundTrackPanel === 'closed') {
    state.groundTrackTracks = [];
    return;
  }
  rebuildGroundTrackTracksFromCache();
}

function pruneGroundTrackHistoriesToWindow() {
  // The worker owns and prunes history; only request a fresh display snapshot.
  syncGroundTrackHistories();
}

let regionSequence = 0;
let lastRegionStats = null;

function regionRange(min, max) {
  return `${formatNumber(min, 2)}° ~ ${formatNumber(max, 2)}°`;
}

// Region stats render as the MOD.06 module: summary strip, per-orbit table, clear / CSV.
function renderGroundTrackStats(stats = null) {
  lastRegionStats = stats;
  if (!stats) {
    els.groundTrackStats.innerHTML = '<div class="empty-list empty">按住 <kbd>Shift</kbd>（或右键）在星下点地图上拖拽框选区域<br>统计各轨道命中点数、最早 / 最晚 UTC 与经纬范围</div>';
    return;
  }
  const bounds = stats.bounds ?? {};
  const summary = `<div class="rg-sum"><span>REGION-${String(regionSequence).padStart(2, '0')}</span><span>经度 <b>${regionRange(bounds.westDeg, bounds.eastDeg)}</b></span><span>纬度 <b>${regionRange(bounds.southDeg, bounds.northDeg)}</b></span><span>${formatNumber(stats.totalPointCount, 0)} 点</span></div>`;
  const actions = '<div class="actions rg-act"><button class="btn sm" type="button" data-region-action="clear">清除选区</button><button class="btn sm" type="button" data-region-action="csv">导出统计 CSV</button></div>';
  if (stats.totalPointCount === 0) {
    els.groundTrackStats.innerHTML = `${summary}<div class="empty-list empty">当前区域没有星下点轨迹经过。</div>${actions}`;
    return;
  }
  els.groundTrackStats.innerHTML = `${summary}<div class="tbl-wrap"><table class="tbl"><thead><tr><th>轨道</th><th>命中</th><th>最早 UTC</th><th>最晚 UTC</th><th>经度范围</th><th>纬度范围</th><th>模型</th></tr></thead><tbody>${stats.items.map((item) => `
    <tr class="ground-track-stat-item"><td><span class="sw color-dot" style="background:${escapeHtml(item.color)}"></span> ${escapeHtml(item.name)}</td><td>${formatNumber(item.pointCount, 0)}</td><td>${formatUtc(item.earliestUtcMs)}</td><td>${formatUtc(item.latestUtcMs)}</td><td>${regionRange(item.westDeg, item.eastDeg)}</td><td>${regionRange(item.southDeg, item.northDeg)}</td><td>${escapeHtml(item.perturbationModel)}</td></tr>`).join('')}</tbody></table></div>${actions}`;
}

function regionStatsCsv(stats) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [['orbit', 'points', 'earliest_utc', 'latest_utc', 'west_deg', 'east_deg', 'south_deg', 'north_deg', 'model']];
  for (const item of stats.items) {
    rows.push([item.name, item.pointCount, new Date(item.earliestUtcMs).toISOString(), new Date(item.latestUtcMs).toISOString(), item.westDeg, item.eastDeg, item.southDeg, item.northDeg, item.perturbationModel]);
  }
  return rows.map((row) => row.map(quote).join(',')).join('\r\n');
}

function handleRegionAction(action) {
  if (action === 'clear') {
    groundTrackView.clearRegion?.();
    renderGroundTrackStats(null);
  } else if (action === 'csv' && lastRegionStats) {
    downloadText(`${state.exportNamePrefix || 'ground-track'}-region-${currentTimestampLabel()}.csv`, '\uFEFF' + regionStatsCsv(lastRegionStats), 'text/csv;charset=utf-8');
  }
}

function activeAssetGroup() {
  return state.assetGroups.find((group) => group.id === state.currentAssetId) ?? null;
}

function renderAssetLibrary() {
  if (!els.assetGroupList) return;
  const activeGroup = activeAssetGroup();
  els.assetDirtyState.textContent = state.isSceneDirty
    ? activeGroup ? '有未保存修改' : '未保存'
    : activeGroup ? '已保存' : '未保存';
  els.assetDirtyState.classList.toggle('dirty', state.isSceneDirty);
  renderRosterMeta();
  els.assetGroupName.value = activeGroup?.name ?? els.assetGroupName.value;
  els.assetGroupName.placeholder = `组名，留空默认 ${defaultAssetGroupName()}`;
  els.assetGroupList.innerHTML = '';

  if (state.assetGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '暂无轨道组。保存当前轨道组后可在此快速切换。';
    els.assetGroupList.append(empty);
    return;
  }

  for (const group of state.assetGroups) {
    const row = document.createElement('article');
    const isCurrent = group.id === state.currentAssetId;
    row.className = `asset-group-row gitem${isCurrent ? ' is-active cur' : ''}`;

    const main = document.createElement('button');
    main.className = 'orbit-main';
    main.type = 'button';
    main.title = '载入此轨道组';
    main.innerHTML = `<strong>${escapeHtml(group.name)}${isCurrent ? '<span class="badge" data-i18n-skip>CURRENT</span>' : ''}</strong><span>${group.snapshot?.orbits?.length ?? 0} 条轨道 · ${escapeHtml(formatUtc(group.updatedAt))}</span>`;
    main.addEventListener('click', () => loadAssetGroup(group.id));

    const textButton = (label, title, onClick) => {
      const button = document.createElement('button');
      button.className = 'btn';
      button.type = 'button';
      button.title = title;
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };
    const loadButton = textButton('载入', '载入此轨道组', () => loadAssetGroup(group.id));
    const exportButton = textButton('导出', '导出 JSON', () => {
      downloadText(`${group.name || 'orbit-group'}-${currentTimestampLabel()}.json`, JSON.stringify({
        version: 1,
        snapshot: group.snapshot,
      }, null, 2));
    });
    const renameButton = textButton('重命名', '重命名', () => renameAssetGroup(group.id));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'ib';
    deleteButton.type = 'button';
    deleteButton.title = '删除';
    deleteButton.setAttribute('aria-label', `删除轨道组 ${group.name}`);
    deleteButton.innerHTML = icon('trash');
    deleteButton.addEventListener('click', () => deleteAssetGroup(group.id));

    const actions = document.createElement('div');
    actions.className = 'ga';
    actions.append(loadButton, exportButton, renameButton, deleteButton);

    row.append(main, actions);
    els.assetGroupList.append(row);
  }
}

// Unnamed groups take 轨道组001, 轨道组002 … — the first number not already used.
function defaultAssetGroupName() {
  const taken = new Set(state.assetGroups.map((group) => group.name));
  let n = 1;
  while (taken.has(`轨道组${String(n).padStart(3, '0')}`)) n += 1;
  return `轨道组${String(n).padStart(3, '0')}`;
}

function saveCurrentAssetGroup() {
  const name = els.assetGroupName.value.trim() || activeAssetGroup()?.name || defaultAssetGroupName();
  const now = new Date().toISOString();
  const snapshot = serializeWorkbenchSnapshot();
  let group = activeAssetGroup();
  if (!group) {
    group = { id: uuid(), name, createdAt: now, updatedAt: now, snapshot };
    state.assetGroups.unshift(group);
    state.currentAssetId = group.id;
  } else {
    group.name = name;
    group.updatedAt = now;
    group.snapshot = snapshot;
  }
  state.isSceneDirty = false;
  saveState();
  renderAssetLibrary();
}

async function loadAssetGroup(id) {
  const group = state.assetGroups.find((item) => item.id === id);
  if (!group) return;
  if (state.isSceneDirty && !window.confirm('当前轨道组有未保存修改，切换会丢弃这些修改。是否继续？')) return;
  try { await applyWorkbenchSnapshot(group.snapshot); }
  catch (error) { showErrors(error.message); return; }
  state.currentAssetId = group.id;
  state.isSceneDirty = false;
  renderUi();
  saveState();
}

function renameAssetGroup(id = state.currentAssetId) {
  const group = state.assetGroups.find((item) => item.id === id);
  if (!group) return;
  const nextName = window.prompt('请输入新的轨道组名称', group.name);
  if (!nextName?.trim()) return;
  group.name = nextName.trim();
  group.updatedAt = new Date().toISOString();
  saveState();
  renderAssetLibrary();
}

function deleteAssetGroup(id) {
  const group = state.assetGroups.find((item) => item.id === id);
  if (!group) return;
  if (!window.confirm(`确认删除轨道组“${group.name}”？`)) return;
  state.assetGroups = state.assetGroups.filter((item) => item.id !== id);
  if (state.currentAssetId === id) {
    state.currentAssetId = null;
    state.isSceneDirty = true;
  }
  saveState();
  renderAssetLibrary();
}

function clearCurrentSceneWithConfirmation() {
  if (state.isSceneDirty && !window.confirm('当前轨道组尚未保存到资产，清除后无法恢复。是否继续？')) return;
  workspaceOperation += 1;
  persistenceReady = true;
  state.orbits = [];
  state.trajectories = [];
  renderTrajectories();
  state.isPlaying = false;
  setSelectedOrbitIds([]);
  state.editingId = null;
  state.elapsedSeconds = 0;
  state.currentAssetId = null;
  state.isSceneDirty = false;
  clearGroundTrackHistories();
  clearVectorCalibration();
  resetForm();
  renderUi();
  saveState();
}

function applyGroundTrackPanelState() {
  const isOpen = isGroundTrackDrawing();
  const isFullscreen = state.groundTrackPanel === 'fullscreen';
  const isClosed = state.groundTrackPanel === 'closed';
  els.groundTrackPanel.classList.toggle('is-open', isOpen);
  els.groundTrackPanel.classList.toggle('is-fullscreen', isFullscreen);
  els.groundTrackPanel.classList.toggle('is-minimized', state.groundTrackPanel === 'minimized');
  els.groundTrackPanel.hidden = isClosed;
  els.groundTrackClosed.hidden = !isClosed;
  els.groundTrackMinimize.setAttribute('aria-pressed', String(state.groundTrackPanel === 'minimized'));
  els.groundTrackModeToggle.setAttribute('aria-pressed', String(isFullscreen));
  groundTrackView.setPanelOpen(isOpen);
  groundTrackView.setFullscreen(isFullscreen);
}

function shouldConfirmGroundTrackClose() {
  return state.isPlaying && Object.values(state.groundTrackFilters).some(Boolean);
}

function setGroundTrackPanel(mode, { confirmClose = true } = {}) {
  const nextMode = ['window', 'fullscreen', 'minimized'].includes(mode) ? mode : 'closed';
  if (nextMode === 'closed' && confirmClose && shouldConfirmGroundTrackClose()) {
    const confirmed = window.confirm('当前仿真正在运行，且已有星下点轨迹被选中。关闭星下点模块将中止该模块的后台计算，是否继续？');
    if (!confirmed) return;
  }
  state.groundTrackPanel = nextMode;
  // The map lives in the ground-track view: closing keeps the view (showing a reopen
  // placeholder) and stops backend recording; minimise collapses it while recording continues.
  if (nextMode === 'closed') clearGroundTrackHistories();
  applyGroundTrackPanelState();
  applyModuleState();
  if (nextMode !== 'closed') syncGroundTrackHistories();
  if (isGroundTrackDrawing()) {
    requestAnimationFrame(() => {
      groundTrackView.resize();
      renderGroundTrack({ force: true });
    });
  }
  saveState();
}

function renderGroundTrack(options = {}) {
  const isOpen = isGroundTrackDrawing();
  groundTrackView.setPanelOpen(isOpen);
  groundTrackView.setFullscreen(state.groundTrackPanel === 'fullscreen');
  if (!isOpen) return;

  const nowMs = performance.now();
  const minIntervalMs = state.isPlaying ? 240 : 800;
  if (!options.force && nowMs - state.lastGroundTrackRenderMs < minIntervalMs) {
    groundTrackView.setData(state.groundTrackTracks, groundTrackDataOptions());
    return;
  }

  state.lastGroundTrackRenderMs = nowMs;
  rebuildGroundTrackTracksFromCache();
  groundTrackView.setData(state.groundTrackTracks, groundTrackDataOptions());
}

function groundTrackDataOptions(isPlaying = state.isPlaying) {
  return {
    selectedIds: state.selectedIds,
    elapsedSeconds: state.elapsedSeconds,
    isPlaying,
    utcMs: utcMsFromInput(state.simulationStartUtc, Date.now()) + state.elapsedSeconds * 1000,
  };
}

function exportGroundTrackPng() {
  syncGroundTrackHistories();
  rebuildGroundTrackTracksFromCache();
  groundTrackView.setData(state.groundTrackTracks, groundTrackDataOptions(false));
  const png = groundTrackView.capturePng({ width: 1920, height: 1080 });
  const prefix = (state.exportNamePrefix || 'ground-track').trim() || 'ground-track';
  downloadDataUrl(`${prefix}-${currentTimestampLabel()}.png`, png);
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function composeScreenshotDataUrl() {
  // in the ground-track view the 3D viewport is the mini schematic
  const viewScene = state.activeView === 'groundTrack' && miniScene ? miniScene : scene;
  const sceneCanvas = viewScene === miniScene ? els.miniCanvas : els.canvas;
  const scenePng = viewScene.capturePng();
  if (!isGroundTrackDrawing()) return scenePng;

  const mapPng = groundTrackView.capturePng();
  if (state.groundTrackPanel === 'fullscreen') return mapPng;

  // Ground-track view: map and 3D viewport sit side by side; keep their on-screen layout.
  const [sceneImage, mapImage] = await Promise.all([
    loadImageFromDataUrl(scenePng),
    loadImageFromDataUrl(mapPng),
  ]);
  const sceneRect = sceneCanvas.getBoundingClientRect();
  const mapRect = els.groundTrackCanvas.getBoundingClientRect();
  const left = Math.min(sceneRect.left, mapRect.left);
  const top = Math.min(sceneRect.top, mapRect.top);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(Math.max(sceneRect.right, mapRect.right) - left));
  canvas.height = Math.max(1, Math.round(Math.max(sceneRect.bottom, mapRect.bottom) - top));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#E7EEED';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [image, rect] of [[mapImage, mapRect], [sceneImage, sceneRect]]) {
    ctx.drawImage(image, Math.round(rect.left - left), Math.round(rect.top - top), Math.round(rect.width), Math.round(rect.height));
    ctx.strokeStyle = 'rgba(40, 78, 80, 0.36)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(rect.left - left) + 0.5, Math.round(rect.top - top) + 0.5, Math.round(rect.width) - 1, Math.round(rect.height) - 1);
  }
  return canvas.toDataURL('image/png');
}

function renderUi() {
  frameRevision += 1;
  frameDirty = true;
  els.orbitCount.textContent = String(state.orbits.filter((orbit) => orbit.visible).length);
  els.emptyState.classList.toggle('is-hidden', state.orbits.length > 0);
  els.playToggle.disabled = state.isPlaying;
  els.pauseButton.disabled = !state.isPlaying;
  updateTimeReadout();
  applyModuleState();
  updateStatusSelections();
  syncFormToSelection();
  renderOrbitList();
  renderStatusOrbitMenu();
  renderMetrics();
  renderCalibrationEditor();
  renderCalibrationTargets();
  renderCalibrationResults();
  syncOverlayControlsFromState();
  scene.setFrame(state.frame);
  scene.setEpoch?.(utcMsFromInput(state.simulationStartUtc, Date.now()));
  scene.setOverlayVisibility(state.overlays);
  scene.syncOrbits(state.orbits, state.perturbationModel);
  scene.setSelectedOrbits(state.selectedIds);
  syncGroundTrackControlsFromState();
  syncSegmentedSelects();
  syncGroundTrackOptionControls();
  syncSettingsControls();
  currentGroundTrackBudget();
  applyGroundTrackPanelState();
  renderGroundTrackFilters();
  renderAssetLibrary();
  syncGroundTrackHistories();
  renderGroundTrack({ force: true });
  ensureBackendReferences();
}

function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function exportJson() {
  const payload = {
    version: 1,
    snapshot: serializeWorkbenchSnapshot(),
    units: { distance: 'km', angle: '°', time: 's' },
  };
  downloadText(`eci-orbits-${currentTimestampLabel()}.json`, JSON.stringify(payload, null, 2));
}

async function importJson(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const snapshot = payload.snapshot ?? payload;
    if (!Array.isArray(snapshot.orbits)) throw new Error('JSON 中缺少 orbits 数组。');
    await applyWorkbenchSnapshot(snapshot);
    state.currentAssetId = null;
    state.isSceneDirty = true;
    clearGroundTrackHistories();
    clearVectorCalibration();
    renderUi();
    saveState();
  } catch (error) {
    showErrors(`导入失败：${error.message}`);
  } finally {
    els.importJson.value = '';
  }
}

/* ---------- import: TXT kinds go through the import window (central body or frame) ---------- */
// Trajectories live beside the orbit roster for this session only; workspace JSON does not
// carry them yet (docs/import-integration.md).
let pendingImport = null;
const IMPORT_KINDS = {
  elements: { code: 'IMPORT · ORBIT ELEMENTS', label: '轨道六要素' },
  group: { code: 'IMPORT · ELEMENT GROUP', label: '统一六要素组' },
  trajectory: { code: 'IMPORT · TRAJECTORY', label: '位置矢量轨迹' },
};

function setImportOptionsOpen(open) {
  els.importDataToggle.setAttribute('aria-expanded', String(open));
  els.importDataOptions.hidden = !open;
  if (open) { els.importDataOptions.classList.remove('in'); void els.importDataOptions.offsetWidth; els.importDataOptions.classList.add('in'); }
}

async function readImportFile(input, kind, parse) {
  const file = input.files[0];
  if (!file) return;
  try {
    openImportDialog({ kind, fileName: file.name, ...parse(await file.text(), file.name) });
  } catch (error) {
    showErrors(`导入${IMPORT_KINDS[kind].label}失败：${error.message}`);
  } finally {
    input.value = '';
  }
}

const importTxt = () => readImportFile(els.importTxt, 'elements', (text) => parseOrbitFile(text));
const importGroupTxt = () => readImportFile(els.importGroupTxt, 'group', (text) => parseElementGroupText(text));
const importTrajectoryTxt = () => readImportFile(els.importTrajectoryTxt, 'trajectory', (text, fileName) => {
  const parsed = parseTrajectoryText(text);
  const base = fileName.replace(/\.[^.]+$/, '');
  const offset = state.orbits.length + state.trajectories.length;
  return {
    trajectories: parsed.map((trajectory, index) => ({
      ...trajectory,
      // an unnamed single trajectory takes the file name
      name: parsed.length === 1 && /^轨迹 \d+$/.test(trajectory.name) ? base : trajectory.name,
      color: nextOrbitColor(offset + index),
      dense: smoothTrajectory(trajectory.samples),
    })),
  };
});

function importTableHtml(pending) {
  const limit = 60;
  if (pending.kind === 'trajectory') {
    const rows = pending.trajectories.map((trajectory) => [
      `<span class="sw-dot" style="--c:${trajectory.color}"></span>${escapeHtml(trajectory.name)}`,
      formatNumber(trajectory.samples.length, 0),
      escapeHtml(trajectoryStartLabel(trajectory.timeOrigin)),
      formatNumber(trajectory.samples[trajectory.samples.length - 1].t, 1),
      trajectory.hasVelocity ? 'r + v' : 'r',
    ]);
    return `<thead><tr><th>NAME</th><th>PTS</th><th>START</th><th>SPAN s</th><th>DATA</th></tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }
  const rows = pending.records.slice(0, limit).map((item) => [
    escapeHtml(item.name), formatNumber(item.semiMajorAxisKm, 3), formatNumber(item.eccentricity, 6), formatNumber(item.inclinationDeg, 4),
    formatNumber(item.raanDeg, 4), formatNumber(item.argPeriapsisDeg, 4), formatNumber(item.trueAnomalyDeg, 4),
  ]);
  const more = pending.records.length > limit ? `<tr class="more"><td colspan="7">… +${pending.records.length - limit}</td></tr>` : '';
  return `<thead><tr><th>NAME</th><th>a km</th><th>e</th><th>i °</th><th>Ω °</th><th>ω °</th><th>ν °</th></tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}${more}</tbody>`;
}

function trajectoryStartLabel(timeOrigin) {
  return timeOrigin.kind === 'utc'
    ? `${new Date(timeOrigin.utcMs).toISOString().slice(0, 19).replace('T', ' ')}Z`
    : `T+${formatNumber(timeOrigin.elapsedSeconds, 1)} s`;
}

function openImportDialog(pending) {
  pendingImport = pending;
  const isTrajectory = pending.kind === 'trajectory';
  const count = isTrajectory ? pending.trajectories.length : pending.records.length;
  els.importDialogKind.textContent = IMPORT_KINDS[pending.kind].code;
  els.importDialogFile.textContent = pending.fileName;
  els.importDialogCount.textContent = `${count} 条`;
  els.importDialogMeta.textContent = isTrajectory
    ? `位置矢量轨迹 · ${pending.trajectories.reduce((sum, trajectory) => sum + trajectory.samples.length, 0)} 个采样点`
    : pending.groupName ? `${IMPORT_KINDS[pending.kind].label} · 组名 ${pending.groupName}` : IMPORT_KINDS[pending.kind].label;
  els.importDialogTable.innerHTML = importTableHtml(pending);
  els.importDialogNote.textContent = isTrajectory
    ? '轨迹叠加显示在工作台，不替换现有轨道；本次会话内保留，刷新页面后需重新导入。'
    : state.orbits.length ? `确认后替换当前场景中的 ${state.orbits.length} 条轨道。` : '确认后载入为当前场景。';
  els.importBodyChoice.hidden = isTrajectory;
  els.importFrameChoice.hidden = !isTrajectory;
  for (const input of els.importDialog.querySelectorAll('input[type="radio"]')) input.checked = false;
  showImportError('');
  syncImportConfirm();
  els.importDialogPreview.hidden = !isTrajectory;
  els.importDialog.classList.add('is-open');
  document.getElementById('import-scrim').classList.add('is-on');
  if (isTrajectory) requestAnimationFrame(() => drawTrajectoryPreview(pending.trajectories));
  setTimeout(() => els.importDialog.querySelector('fieldset:not([hidden]) input:not(:disabled)')?.focus({ preventScroll: true }), 60);
}

function importDialogOpen() {
  return els.importDialog.classList.contains('is-open');
}

function closeImportDialog() {
  pendingImport = null;
  els.importDialog.classList.remove('is-open');
  document.getElementById('import-scrim').classList.remove('is-on');
}

function importChoice() {
  const name = pendingImport?.kind === 'trajectory' ? 'import-frame' : 'import-body';
  return els.importDialog.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
}

function syncImportConfirm() {
  els.importDialogConfirm.disabled = !importChoice();
  els.importDialogConfirm.title = els.importDialogConfirm.disabled ? (pendingImport?.kind === 'trajectory' ? '请先选择坐标系' : '请先选择中心天体') : '';
}

function showImportError(message) {
  els.importDialogError.textContent = message;
  els.importDialogError.classList.toggle('is-visible', Boolean(message));
}

async function confirmImport() {
  const pending = pendingImport;
  const choice = importChoice();
  if (!pending || !choice) return;
  els.importDialogConfirm.disabled = true;
  try {
    if (pending.kind === 'trajectory') addTrajectories(pending.trajectories, choice);
    else await applyElementsImport(pending.records, { centerBody: choice, groupName: pending.groupName });
    closeImportDialog();
  } catch (error) {
    showImportError(`导入失败：${error.message}`);
    syncImportConfirm();
  }
}

// Equatorial-plane (x–y) sketch of the smoothed curves as they appear in the file's coordinates.
function drawTrajectoryPreview(trajectories) {
  const canvas = els.importDialogPreview;
  const W = canvas.clientWidth; const H = canvas.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let extent = 6378.137;
  for (const trajectory of trajectories) for (const { p } of trajectory.dense) extent = Math.max(extent, Math.abs(p[0]), Math.abs(p[1]));
  const k = (Math.min(W, H) / 2 - 14) / extent;
  const cx = W / 2; const cy = H / 2;
  ctx.strokeStyle = 'rgba(34,50,58,.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  ctx.fillStyle = '#EEF4F3'; ctx.strokeStyle = '#627276';
  ctx.beginPath(); ctx.arc(cx, cy, 6378.137 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  for (const trajectory of trajectories) {
    ctx.strokeStyle = displayColorOnLight(trajectory.color); ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.beginPath();
    trajectory.dense.forEach(({ p }, index) => (index ? ctx.lineTo(cx + p[0] * k, cy - p[1] * k) : ctx.moveTo(cx + p[0] * k, cy - p[1] * k)));
    ctx.stroke();
    ctx.fillStyle = '#22323A';
    if (trajectory.samples.length <= 400) {
      for (const { positionKm } of trajectory.samples) { ctx.beginPath(); ctx.arc(cx + positionKm.x * k, cy - positionKm.y * k, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    const start = trajectory.samples[0].positionKm;
    ctx.strokeStyle = '#22323A'; ctx.lineWidth = 1.2; ctx.strokeRect(cx + start.x * k - 3.5, cy - start.y * k - 3.5, 7, 7);
  }
  ctx.font = '500 9.5px "JetBrains Mono",Consolas,monospace'; ctx.fillStyle = '#4A5F64';
  ctx.fillText('X', W - 12, cy - 4); ctx.fillText('Y', cx + 4, 11);
  ctx.fillText('XY · SMOOTHED', 6, H - 6);
}

function addTrajectories(trajectories, frame) {
  state.trajectories.push(...trajectories.map((trajectory) => ({
    id: uuid(),
    name: trajectory.name,
    color: trajectory.color,
    visible: true,
    frame,
    centerBody: 'earth',
    timeOrigin: trajectory.timeOrigin,
    hasVelocity: trajectory.hasVelocity,
    samples: trajectory.samples,
    dense: trajectory.dense,
  })));
  renderTrajectories();
}

function trajectoryMetaLabel(trajectory) {
  const span = trajectory.samples[trajectory.samples.length - 1].t;
  return `${trajectory.frame} · ${formatNumber(trajectory.samples.length, 0)} 点 · ${trajectoryStartLabel(trajectory.timeOrigin)} · ${formatNumber(span, 0)} s`;
}

function renderTrajectories() {
  scene.setTrajectories?.(state.trajectories);
  els.trajectorySection.hidden = state.trajectories.length === 0;
  els.trajectoryCount.textContent = String(state.trajectories.length);
  els.trajectoryList.replaceChildren(...state.trajectories.map((trajectory) => {
    const row = document.createElement('div');
    row.className = `traj-row${trajectory.visible ? '' : ' is-hidden'}`;
    row.setAttribute('role', 'listitem');
    row.style.setProperty('--c', trajectory.color);
    row.innerHTML = `<i aria-hidden="true"></i><div><strong>${escapeHtml(trajectory.name)}</strong><span>${escapeHtml(trajectoryMetaLabel(trajectory))}</span></div>`;
    const actions = document.createElement('div');
    actions.className = 'ga';
    actions.append(
      iconButton('', trajectory.visible ? 'eye' : 'eyeOff', trajectory.visible ? '隐藏轨迹' : '显示轨迹', () => { trajectory.visible = !trajectory.visible; renderTrajectories(); }, !trajectory.visible),
      iconButton('', 'trash', '删除轨迹', () => { state.trajectories = state.trajectories.filter((item) => item !== trajectory); renderTrajectories(); }),
    );
    row.append(actions);
    return row;
  }));
}

function trajectoryTooltipHtml(trajectory) {
  const span = trajectory.samples[trajectory.samples.length - 1].t;
  const rows = [
    ['坐标系', trajectory.frame === 'ECEF' ? 'ECEF 地心地固系' : 'ECI 地心惯性系'],
    ['采样点', formatNumber(trajectory.samples.length, 0)],
    ['起始', trajectoryStartLabel(trajectory.timeOrigin)],
    ['时长', `${formatNumber(span, 1)} s`],
    ['平滑', trajectory.hasVelocity ? 'Hermite（位置 + 速度）' : 'Catmull-Rom（向心）'],
  ];
  return `
    <span class="tt-k" data-i18n-skip>TRAJECTORY // IMPORTED</span>
    <strong>${escapeHtml(trajectory.name)}</strong>
    <dl>
      ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
    </dl>
  `;
}

/* ---------- help · import formats ---------- */
function setHelpFormat(kind) {
  for (const tab of els.helpFormatTabs) {
    const on = tab.dataset.helpFormatTab === kind;
    tab.setAttribute('aria-selected', String(on));
    tab.setAttribute('aria-pressed', String(on));
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
  }
}

function openHelpFormat(kind, button) {
  setHelpFormat(kind);
  const from = state.activeModule && state.activeModule !== 'info' ? state.activeModule : null;
  openModule('info');
  helpReturn = from ? { module: from, focus: button } : null;
  setTimeout(() => document.getElementById('help-formats')?.scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' }), 120);
}

function downloadHelpFormatExample() {
  const panel = document.querySelector('.hf-panel:not([hidden])');
  if (panel) downloadText(panel.dataset.file, panel.querySelector('.hf-code').textContent);
}

async function applyElementsImport(parsed, { centerBody = 'earth', groupName = '' } = {}) {
  if (centerBody !== 'earth') throw new Error('该中心天体尚未接入后台计算。');
  const version = ++workspaceOperation;
  const imported = await buildOrbitRecordsFromSerialized(parsed.map((item, index) => ({
    id: uuid(),
    color: nextOrbitColor(index),
    visible: true,
    elements: item,
  })));
  if (version !== workspaceOperation) throw new Error('场景已更新，忽略过期导入。');
  state.orbits = imported;
  state.centerBody = centerBody;
  if (groupName) els.assetGroupName.value = groupName;
  persistenceReady = true;
  state.isPlaying = false;
  state.elapsedSeconds = 0;
  setSelectedOrbitIds(imported[0] ? [imported[0].id] : [], { currentId: imported[0]?.id ?? null });
  state.editingId = null;
  state.currentAssetId = null;
  state.isSceneDirty = true;
  clearGroundTrackHistories();
  clearVectorCalibration();
  resetForm();
  renderUi();
  saveState();
}

function bindEvents() {
  document.getElementById('task-table')?.addEventListener('toggle', () => { renderTaskTable(backend); scene.resize(); saveState(); });
  document.getElementById('timeline-scrubber')?.addEventListener('input', (event) => {
    state.isPlaying = false;
    state.runStartedAtMs = null;
    state.elapsedSeconds = Number(event.target.value);
    clearGroundTrackHistories();
    clearVectorCalibration();
    updateTimeReadout();
    els.playToggle.disabled = false; els.pauseButton.disabled = true;
  });
  document.getElementById('load-demo-button')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const base = { semiMajorAxisKm: 8000, eccentricity: 0.001, inclinationDeg: 51.6, raanDeg: 40, argPeriapsisDeg: 30, trueAnomalyDeg: 0 };
      await applyWorkbenchSnapshot({ orbits: [
        { id: uuid(), name: 'LEO-01', color: DEFAULT_ORBIT_COLORS[0], visible: true, elements: base },
        { id: uuid(), name: 'POLAR-02', color: DEFAULT_ORBIT_COLORS[1], visible: true, elements: { ...base, semiMajorAxisKm: 8800, eccentricity: .03, inclinationDeg: 98, raanDeg: 112, trueAnomalyDeg: 135 } },
        { id: uuid(), name: 'ELLIPTIC-03', color: DEFAULT_ORBIT_COLORS[2], visible: true, elements: { ...base, semiMajorAxisKm: 10800, eccentricity: .25, inclinationDeg: 27, raanDeg: 205, trueAnomalyDeg: 230 } },
      ] });
      state.currentAssetId = null; state.isSceneDirty = true;
      renderUi(); saveState();
    } catch (error) { showErrors(error.message); }
    finally { document.getElementById('load-demo-button').disabled = false; }
  });
  window.addEventListener('pagehide', flushSavedState);
  document.getElementById('backend-retry')?.addEventListener('click', async () => {
    if (!(await backend.checkHealth())) return;
    clearErrors();
    if (!persistenceReady && state.orbits.length === 0) {
      persistenceReady = (await restoreState()) !== false;
    }
    ensureBackendReferences();
    frameRetryAt = 0;
    renderUi();
  });
  document.getElementById('backend-cancel')?.addEventListener('click', () => {
    backend.cancel().catch((error) => showErrors(error.message));
  });
  new ResizeObserver(() => scene.resize()).observe(els.canvas);
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('#simulation-run-control')) setRunLimitMenuOpen(false);
    // Unpinned drawers close on an outside click; views stay put.
    const moduleSurface = target.closest('.side-module-panel, .module-sidebar, .info-dialog, .import-dialog, .import-scrim, .cfly, .dd');
    if (!moduleSurface && (state.activeModule === 'info' || (DRAWER_MODULES.has(state.activeModule) && !state.modulePins[state.activeModule]))) closeActiveModule();
  });

  for (const button of els.moduleButtons) {
    const moduleName = button.dataset.moduleNav;
    button.addEventListener('click', () => toggleModuleFromSidebar(moduleName));
    button.addEventListener('mouseenter', () => startModulePreview(moduleName));
    button.addEventListener('mouseleave', () => {
      clearTimeout(state.hoverPreviewTimer);
      state.hoverPreviewTimer = null;
      setTimeout(() => {
        if (!document.querySelector(`[data-module-panel="${moduleName}"]`)?.matches(':hover')
          && !button.matches(':hover')
          && state.previewModule === moduleName) {
          endModulePreview();
        }
      }, 80);
    });
  }

  for (const panel of els.modulePanels) {
    panel.addEventListener('mouseleave', () => {
      if (state.previewModule === panel.dataset.modulePanel) endModulePreview();
    });
  }

  for (const button of els.modulePinButtons) {
    button.addEventListener('click', () => toggleModulePin(button.dataset.modulePin));
  }

  els.calibrationAddTarget.addEventListener('click', addOrSaveCalibrationTarget);
  els.calibrationCancelEdit.addEventListener('click', cancelCalibrationTargetEdit);
  els.calibrationSubmitAll.addEventListener('click', runVectorCalibration);
  els.calibrationClearResults.addEventListener('click', clearVectorCalibration);
  els.calibrationTargetEditor.addEventListener('input', (event) => {
    const field = event.target?.dataset?.calibrationDraftField;
    if (!field) return;
    updateCalibrationDraftTarget(field, event.target.value);
  });
  els.calibrationTargetEditor.addEventListener('change', (event) => {
    const field = event.target?.dataset?.calibrationDraftField;
    if (!field) return;
    updateCalibrationDraftTarget(field, event.target.value);
  });
  els.calibrationTargetList.addEventListener('click', (event) => {
    const visibilityButton = event.target?.closest?.('[data-calibration-target-visibility]');
    if (visibilityButton) {
      event.stopPropagation();
      toggleCalibrationTargetVisibility(visibilityButton.dataset.calibrationTargetVisibility);
      return;
    }
    const editButton = event.target?.closest?.('[data-calibration-edit-target]');
    if (editButton) {
      event.stopPropagation();
      editCalibrationTarget(editButton.dataset.calibrationEditTarget);
      return;
    }
    const deleteButton = event.target?.closest?.('[data-calibration-delete-target]');
    if (deleteButton) {
      event.stopPropagation();
      deleteCalibrationTarget(deleteButton.dataset.calibrationDeleteTarget);
      return;
    }
    const toggleButton = event.target?.closest?.('[data-calibration-toggle-result]');
    if (!toggleButton) return;
    toggleCalibrationResultExpansion(toggleButton.dataset.calibrationToggleResult);
  });

  for (const button of document.querySelectorAll('[data-module-close]')) {
    button.addEventListener('click', closeActiveModule);
  }

  for (const button of document.querySelectorAll('[data-frame-option]')) {
    button.addEventListener('click', () => {
      state.frame = button.dataset.frameOption;
      markSceneDirty();
      renderUi();
      closeStatusCards();
      saveState();
    });
  }

  for (const button of document.querySelectorAll('[data-perturbation-model]')) {
    button.addEventListener('click', () => {
      if (!modelsForBody(state.centerBody).includes(button.dataset.perturbationModel)) return;
      if (state.perturbationModel !== button.dataset.perturbationModel) {
        state.perturbationModel = button.dataset.perturbationModel;
        clearGroundTrackHistories();
        clearVectorCalibration();
        markSceneDirty();
      }
      renderUi();
      closeModelFlyout();
      saveState();
    });
  }

  for (const row of els.modelFlyRows) {
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      setModelFlyout(row.getAttribute('aria-expanded') === 'true' ? null : row.dataset.modelFly, { focus: event.detail === 0 });
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); setModelFlyout(row.dataset.modelFly, { focus: true }); }
    });
  }
  for (const fly of document.querySelectorAll('.dd-fly')) {
    fly.addEventListener('keydown', (event) => {
      const items = [...fly.querySelectorAll('button:not(:disabled):not([hidden])')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        closeModelFlyout();
      }
    });
  }

  els.color.picker.addEventListener('input', () => setColorFields(els.color.picker.value));
  els.color.hex.addEventListener('input', () => {
    if (/^#?[\da-f]{6}$/i.test(els.color.hex.value.trim())) setColorFields(els.color.hex.value);
  });
  for (const input of [els.color.r, els.color.g, els.color.b]) {
    input.addEventListener('input', () => {
      setColorFields(rgbToHex(els.color.r.value, els.color.g.value, els.color.b.value));
    });
  }

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = ++workspaceOperation;
    els.submitButton.disabled = true;
    try {
      const raw = formToElements();
      const existingIndex = state.orbits.findIndex((orbit) => orbit.id === state.editingId);
      const record = await buildOrbitRecord(raw, {
        id: state.editingId ?? undefined,
        color: getFormColor(),
        visible: existingIndex >= 0 ? state.orbits[existingIndex].visible : true,
      });
      if (version !== workspaceOperation) throw new Error('场景已更新，忽略过期计算。');
      persistenceReady = true;
      if (existingIndex >= 0) {
        state.orbits.splice(existingIndex, 1, record);
        clearGroundTrackHistories(record.id);
      } else {
        state.orbits.push(record);
      }
      clearVectorCalibration();
      setSelectedOrbitIds([...state.selectedIds.filter((id) => id !== record.id), record.id], { currentId: record.id });
      markSceneDirty();
      clearErrors();
      resetForm();
      renderUi();
      saveState();
    } catch (error) {
      showErrors(error.errors ?? error.message);
    } finally { els.submitButton.disabled = false; }
  });

  els.clearForm.addEventListener('click', clearFormInputs);
  els.editCancel.addEventListener('click', cancelEdit);
  els.selectedOrbitPeriodCell.addEventListener('click', cyclePeriodUnit);
  initColorFlyout({ palette: DEFAULT_ORBIT_COLORS, onPick: setColorFields });
  // Run and pause share one slot (the disabled one is hidden), so hand focus across.
  els.playToggle.addEventListener('click', () => { if (document.activeElement === els.playToggle) els.pauseButton.focus(); });
  els.pauseButton.addEventListener('click', () => { if (document.activeElement === els.pauseButton) els.playToggle.focus(); });
  els.playToggle.addEventListener('click', startPlayback);
  els.runLimitToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setRunLimitMenuOpen(els.runLimitMenu.hidden);
  });
  els.runDurationLimit.addEventListener('input', syncRunLimitFromInput);
  els.runDurationLimit.addEventListener('change', () => {
    syncRunLimitFromInput();
    els.runDurationLimit.value = String(state.runLimitSeconds);
  });
  els.runDurationLimit.addEventListener('input', () => {
    els.runLimitValue.textContent = state.runLimitSeconds > 0 ? `${state.runLimitSeconds}s` : '∞';
  });
  els.pauseButton.addEventListener('click', pausePlayback);
  els.resetTime.addEventListener('click', () => {
    state.elapsedSeconds = 0;
    clearGroundTrackHistories();
    clearVectorCalibration();
    if (state.isPlaying) {
      const nowMs = performance.now();
      state.lastFrameMs = nowMs;
      state.runStartedAtMs = nowMs;
    } else {
      state.runStartedAtMs = null;
    }
    renderUi();
  });
  els.frontView.addEventListener('click', () => scene.setView('front'));
  els.topView.addEventListener('click', () => scene.setView('top'));
  els.resetView.addEventListener('click', () => scene.setView('default'));
  els.planeViewToggle.addEventListener('click', (event) => setPlaneViewPop(!planeViewOpen(), { focus: event.detail === 0 }));
  els.planeViewForm.addEventListener('submit', applyPlaneView);
  els.planeViewFromOrbit.addEventListener('click', planeViewFromSelectedOrbit);
  for (const input of [els.planeViewInc, els.planeViewRaan]) input.addEventListener('input', () => showPlaneViewError());
  document.getElementById('tools-hide').addEventListener('click', () => setPlaneViewPop(false));
  document.addEventListener('pointerdown', (event) => {
    if (planeViewOpen() && !event.target.closest?.('#plane-view-pop, #plane-view-toggle')) setPlaneViewPop(false);
  });
  window.addEventListener('resize', () => { if (planeViewOpen()) placePlaneViewPop(); });
  els.speedFactor.addEventListener('change', () => {
    state.speedFactor = Number(els.speedFactor.value);
  });
  els.timeReadoutPanel.addEventListener('dblclick', cycleSimulationTimeUnit);
  els.groundTrackModeToggle.addEventListener('click', () => {
    setGroundTrackPanel(state.groundTrackPanel === 'fullscreen' ? 'window' : 'fullscreen');
  });
  els.groundTrackMinimize.addEventListener('click', () => setGroundTrackPanel(state.groundTrackPanel === 'minimized' ? 'window' : 'minimized', { confirmClose: false }));
  els.groundTrackClose.addEventListener('click', () => setGroundTrackPanel('closed'));
  els.groundTrackReopen.addEventListener('click', () => setGroundTrackPanel('window'));
  els.groundTrackStats.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-region-action]');
    if (button) handleRegionAction(button.dataset.regionAction);
  });
  els.groundTrackResetView.addEventListener('click', () => groundTrackView.resetView());
  els.simulationStartUtc.addEventListener('change', () => {
    state.simulationStartUtc = els.simulationStartUtc.value || utcDatetimeLocalValue(new Date());
    scene.setEpoch?.(utcMsFromInput(state.simulationStartUtc, Date.now()));
    markSceneDirty();
    clearGroundTrackHistories();
    syncGroundTrackHistories();
    renderGroundTrack({ force: true });
    saveState();
  });
  for (const input of [
    els.groundTrackWindowMode,
    els.groundTrackPastRevs,
    els.groundTrackRetentionTime,
  ]) {
    input.addEventListener('change', () => {
      syncGroundTrackWindowFromControls();
      markSceneDirty();
      pruneGroundTrackHistoriesToWindow();
      syncGroundTrackHistories();
      renderGroundTrack({ force: true });
      saveState();
    });
  }
  els.groundTrackRetentionUnit.addEventListener('change', () => {
    state.groundTrackWindow.timeUnit = normalizeTimeUnit(els.groundTrackRetentionUnit.value);
    syncGroundTrackControlsFromState();
    syncGroundTrackWindowFromControls();
    markSceneDirty();
    pruneGroundTrackHistoriesToWindow();
    syncGroundTrackHistories();
    renderGroundTrack({ force: true });
    saveState();
  });
  for (const input of [els.performanceMode, els.customMemory]) {
    input.addEventListener('change', () => {
      syncPerformanceFromControls();
      syncGroundTrackHistories();
      renderGroundTrack({ force: true });
      saveState();
    });
  }
  // dragging the memory slider switches to the custom preset, as in the prototype
  els.customMemory.addEventListener('input', () => {
    if (els.performanceMode.value !== 'custom') els.performanceMode.value = 'custom';
    syncPerformanceFromControls();
  });
  els.frameRateLimit.addEventListener('change', () => {
    const value = Number(els.frameRateLimit.value);
    state.frameRateLimit = FRAME_RATE_LIMITS.includes(value) ? value : 60;
    renderSettingsReadouts();
    saveState();
  });
  for (const input of [
    els.groundTrackHighlightLongitude,
    els.groundTrackHighlightLatitude,
    els.groundTrackHighlightEquator,
    els.groundTrackCursorGuides,
  ]) {
    input.addEventListener('change', () => {
      syncGroundTrackOptionsFromControls();
      markSceneDirty();
      renderGroundTrack({ force: true });
      saveState();
    });
  }
  els.exportNamePrefix.addEventListener('input', () => {
    state.exportNamePrefix = els.exportNamePrefix.value;
    saveState();
  });
  els.assetSaveGroup.addEventListener('click', saveCurrentAssetGroup);
  els.assetRenameGroup.addEventListener('click', () => renameAssetGroup());
  els.exportGroundTrackPng.addEventListener('click', exportGroundTrackPng);
  els.groundTrackCsv?.addEventListener('click', () => downloadText(
    `${state.exportNamePrefix || 'ground-track'}-${currentTimestampLabel()}.csv`,
    '\uFEFF' + groundTrackCsv(state.groundTrackTracks), 'text/csv;charset=utf-8',
  ));
  els.infoClose.addEventListener('click', closeActiveModule);
  els.exitPage.addEventListener('click', () => {
    saveState();
    window.close();
  });
  const downloadSceneScreenshot = async () => {
    const png = await composeScreenshotDataUrl();
    downloadDataUrl(`eci-orbit-scene-${currentTimestampLabel()}.png`, png);
  };
  els.screenshotButton.addEventListener('click', downloadSceneScreenshot);
  document.getElementById('ground-track-screenshot')?.addEventListener('click', downloadSceneScreenshot);
  els.exportJson.addEventListener('click', exportJson);
  els.importJson.addEventListener('change', () => importJson(els.importJson.files[0]));
  els.importTxt.addEventListener('change', importTxt);
  els.importGroupTxt.addEventListener('change', importGroupTxt);
  els.importTrajectoryTxt.addEventListener('change', importTrajectoryTxt);
  els.importDataToggle.addEventListener('click', () => setImportOptionsOpen(els.importDataOptions.hidden));
  for (const button of document.querySelectorAll('[data-help-format]')) button.addEventListener('click', () => openHelpFormat(button.dataset.helpFormat, button));
  els.importDialog.addEventListener('change', (event) => { if (event.target.matches('input[type="radio"]')) { showImportError(''); syncImportConfirm(); } });
  els.importDialogConfirm.addEventListener('click', confirmImport);
  document.getElementById('import-dialog-cancel').addEventListener('click', closeImportDialog);
  document.getElementById('import-dialog-close').addEventListener('click', closeImportDialog);
  document.getElementById('import-scrim').addEventListener('click', closeImportDialog);
  for (const tab of els.helpFormatTabs) tab.addEventListener('click', () => setHelpFormat(tab.dataset.helpFormatTab));
  els.helpFormatDownload.addEventListener('click', downloadHelpFormatExample);
  els.clearAll.addEventListener('click', clearCurrentSceneWithConfirmation);
  for (const input of Object.values(els.toggles)) {
    if (input) input.addEventListener('change', () => setOverlaysFromInputs());
  }
  window.addEventListener('resize', () => {
    scene.resize();
    groundTrackView.resize();
    renderGroundTrack({ force: true });
  });
  groundTrackView.setRegionSelectedCallback((bounds) => {
    const stats = groundTrackRegionStats(state.groundTrackTracks, bounds);
    regionSequence += 1;
    renderGroundTrackStats(stats);
    els.groundTrackStatsPanel.classList.remove('flash'); void els.groundTrackStatsPanel.offsetWidth;
    els.groundTrackStatsPanel.classList.add('flash');
    setTimeout(() => els.groundTrackStatsPanel.classList.remove('flash'), 900);
  });
  scene.setOrbitHoverCallback(showOrbitTooltip);
  // clicking an orbit in the schematic selects it on its own (prototype interaction)
  scene.setOrbitClickCallback?.((id) => {
    setSelectedOrbitIds([id], { currentId: id });
    renderUi();
    saveState();
  });
  document.addEventListener('keydown', handleShortcut);
}

// Escape peels back one layer; 1/2/3, Space, R and F/T/0/P drive views, playback and camera.
function handleShortcut(event) {
  if (event.key === 'Escape') {
    if (importDialogOpen()) { closeImportDialog(); return; }
    if (modelFlyoutOpen()) { closeModelFlyout(); return; }
    if (document.querySelector('.dd-btn[aria-expanded="true"]')) { closeDropdowns(); return; }
    if (planeViewOpen()) { setPlaneViewPop(false); els.planeViewToggle.focus(); return; }
    if (colorFlyoutOpen()) { setColorFlyout(false); els.color.preview.closest('button')?.focus(); return; }
    if (!els.runLimitMenu.hidden) { setRunLimitMenuOpen(false); els.runLimitToggle.focus(); return; }
    if (state.activeModule) closeActiveModule();
    return;
  }
  if (event.target.closest?.('input, select, textarea, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (state.activeModule === 'info') return;
  const key = event.key.toLowerCase();
  if (key === ' ' && !event.target.closest?.('button, a, [role="slider"], summary')) {
    event.preventDefault();
    if (state.isPlaying) pausePlayback(); else startPlayback();
  } else if (key === 'r') els.resetTime.click();
  else if (key === '1') setActiveView('workbench');
  else if (key === '2') setActiveView('groundTrack');
  else if (key === '3') setActiveView('console');
  else if (state.activeView === 'workbench' && key === 'f') scene.setView('front');
  else if (state.activeView === 'workbench' && key === 't') scene.setView('top');
  else if (state.activeView === 'workbench' && key === '0') scene.setView('default');
  else if (state.activeView === 'workbench' && key === 'p') { event.preventDefault(); setPlaneViewPop(!planeViewOpen(), { focus: true }); }
}

// Bottom-bar PWR / TEMP come from real backend load: the larger of frame compute time over the
// frame interval and worker-thread occupancy. PWR is the headroom left; TEMP follows the load
// slowly (36–47) like a thermal reading, so short spikes do not flicker it.
const computeLoad = { frame: 0, frameAt: 0, level: 0, heat: 0 };
function updateComputeTelemetry(nowMs) {
  const health = backend.health ?? {};
  const workers = Number(health.workers);
  const threads = workers > 0 ? Math.min(1, Number(health.running ?? 0) / workers) : 0;
  const frame = state.isPlaying && nowMs - computeLoad.frameAt < 1000 ? computeLoad.frame : 0;
  computeLoad.level += (Math.max(frame, threads) - computeLoad.level) * 0.35;
  computeLoad.heat += (computeLoad.level - computeLoad.heat) * 0.03;
  if (els.telemetryPower) els.telemetryPower.textContent = backend.health ? `${(100 - computeLoad.level * 100).toFixed(1)}%` : '—';
  if (els.telemetryTemp) els.telemetryTemp.textContent = backend.health ? `${(36 + computeLoad.heat * 11).toFixed(1)}°C` : '—';
}

let frameMsAverage = 16.7;
let telemetryAt = 0;
let paintedAt = 0;
function tick(nowMs) {
  requestAnimationFrame(tick);
  // frame-rate cap: skip display refreshes that arrive early (1 ms slack so a 60 FPS cap on a
  // 60 Hz display never drops frames); the paint clock advances in whole frame steps
  const frameMs = state.frameRateLimit > 0 ? 1000 / state.frameRateLimit : 0;
  if (frameMs && nowMs - paintedAt < frameMs - 1) return;
  paintedAt = frameMs && nowMs - paintedAt < frameMs * 2 ? paintedAt + frameMs : nowMs;
  frameMsAverage += (nowMs - state.lastFrameMs - frameMsAverage) * 0.08;
  if (nowMs - telemetryAt > 250) {
    telemetryAt = nowMs;
    if (els.telemetryFrame) els.telemetryFrame.textContent = `${Math.max(0, frameMsAverage).toFixed(1)}ms`;
    updateComputeTelemetry(nowMs);
  }
  state.lastFrameMs = nowMs;
  if (state.isPlaying) {
    const elapsedRunSeconds = state.runStartedAtMs === null ? 0 : (nowMs - state.runStartedAtMs) / 1000;
    if (state.runLimitSeconds > 0 && elapsedRunSeconds >= state.runLimitSeconds) {
      state.isPlaying = false;
      state.runStartedAtMs = null;
      renderUi();
    }
  }
  requestComputedFrame(nowMs);
  updateTimeReadout();
  scene.update(state.orbits, state.elapsedSeconds, state.perturbationModel);
}

if (!state.simulationStartUtc) state.simulationStartUtc = utcDatetimeLocalValue(new Date());
initI18n();
initDropdowns();
initSegmentedSelects();
initPanelToggles();
initListFades();
initMotes();
restoreAssetLibrary();
renderGroundTrackStats(null);
bindEvents();
renderUi();
requestAnimationFrame(tick);
backend.checkHealth().then(async () => {
  const restored = await restoreState();
  persistenceReady = persistenceReady || restored !== false;
  setOverlaysFromInputs({ markDirty: false });
  if (DEFAULT_ORBIT_COLORS.length > 0 && !state.editingId) setNextFormColor();
  renderUi();
});
setInterval(() => backend.checkHealth(), 5000);
