import {
  computeOrbit,
  formatDuration,
  formatNumber,
  propagateOrbit,
} from './orbit.mjs';
import { OrbitScene, orbitReferenceSampleCount } from './scene.mjs';
import {
  DEFAULT_ORBIT_COLORS,
  hexToRgb,
  nextOrbitColor,
  normalizeHexColor,
  rgbToHex,
} from './color.mjs';
import { parseOrbitText } from './importers.mjs';
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
import { GroundTrackView, formatUtc } from './groundtrack-view.mjs';

const STORAGE_KEY = 'eci-orbit-workbench:v1';
const ASSET_LIBRARY_KEY = 'eci-orbit-workbench:asset-groups:v1';
const SIDE_MODULES = new Set(['workbench', 'assets', 'settings']);
const BOTTOM_MODULES = new Set(['groundTrack', 'console']);

const els = {
  body: document.body,
  canvas: document.querySelector('#scene-canvas'),
  moduleSidebar: document.querySelector('#module-sidebar'),
  moduleButtons: Array.from(document.querySelectorAll('[data-module-nav]')),
  modulePanels: Array.from(document.querySelectorAll('[data-module-panel]')),
  modulePinButtons: Array.from(document.querySelectorAll('[data-module-pin]')),
  workbench: document.querySelector('#workbench'),
  pinWorkbench: document.querySelector('#pin-workbench'),
  closeDrawer: document.querySelector('#close-drawer'),
  form: document.querySelector('#orbit-form'),
  submitButton: document.querySelector('#submit-button'),
  clearForm: document.querySelector('#clear-form'),
  formErrors: document.querySelector('#form-errors'),
  orbitList: document.querySelector('#orbit-list'),
  orbitCount: document.querySelector('#orbit-count'),
  orbitListCount: document.querySelector('#orbit-list-count'),
  frameValue: document.querySelector('#frame-value'),
  bodyValue: document.querySelector('#body-value'),
  statusOrbitMenu: document.querySelector('#status-orbit-menu'),
  orbitTooltip: document.querySelector('#orbit-tooltip'),
  selectedOrbitName: document.querySelector('#selected-orbit-name'),
  metrics: document.querySelector('#metrics'),
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
  speedFactor: document.querySelector('#speed-factor'),
  timeReadoutPanel: document.querySelector('.simulation-time-panel'),
  timeReadout: document.querySelector('#time-readout'),
  screenshotButton: document.querySelector('#screenshot-button'),
  simulationStartUtc: document.querySelector('#simulation-start-utc'),
  groundTrackPanel: document.querySelector('#ground-track-panel'),
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
  exportNamePrefix: document.querySelector('#export-name-prefix'),
  exportGroundTrackPng: document.querySelector('#export-ground-track-png'),
  assetDirtyState: document.querySelector('#asset-dirty-state'),
  assetGroupName: document.querySelector('#asset-group-name'),
  assetSaveGroup: document.querySelector('#asset-save-group'),
  assetRenameGroup: document.querySelector('#asset-rename-group'),
  assetGroupList: document.querySelector('#asset-group-list'),
  infoModal: document.querySelector('#info-modal'),
  infoClose: document.querySelector('#info-close'),
  consolePanel: document.querySelector('#console-panel'),
  consoleClose: document.querySelector('#console-close'),
  exitPage: document.querySelector('#exit-page'),
  exportJson: document.querySelector('#export-json'),
  importJson: document.querySelector('#import-json'),
  importTxt: document.querySelector('#import-txt'),
  clearAll: document.querySelector('#clear-all'),
  toggles: {
    axes: document.querySelector('#toggle-axes'),
    graticule: document.querySelector('#toggle-graticule'),
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
  },
};

const scene = new OrbitScene(els.canvas);
const groundTrackView = new GroundTrackView({
  canvas: els.groundTrackCanvas,
  tooltip: els.groundTrackTooltip,
  selectionSummary: els.groundTrackSelectionSummary,
});

const state = {
  orbits: [],
  selectedIds: [],
  selectedId: null,
  editingId: null,
  isPlaying: false,
  activeModule: 'workbench',
  committedModule: 'workbench',
  previewModule: null,
  previewReturnModule: null,
  modulePins: {
    workbench: true,
    groundTrack: false,
    assets: false,
    info: false,
    console: false,
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
  exportNamePrefix: 'ground-track',
  assetGroups: [],
  currentAssetId: null,
  isSceneDirty: false,
  groundTrackHistories: new Map(),
  groundTrackTracks: [],
  lastGroundTrackRenderMs: 0,
  frame: 'ECI',
  centerBody: 'earth',
  perturbationModel: 'two-body',
  overlays: {
    axes: true,
    graticule: true,
    ecliptic: true,
    radius: true,
    reference: true,
  },
};

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
  const value = Math.round((Number(seconds) || 0) / TIME_UNIT_SECONDS[normalizedUnit]);
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} ${normalizedUnit}`;
}

function updateTimeReadout() {
  els.timeReadout.textContent = formatSimulationTimeReadout(state.elapsedSeconds);
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

function buildOrbitRecordsFromSerialized(orbits = []) {
  return orbits.map((item, index) => buildOrbitRecord(item.elements ?? item, {
    id: item.id ?? uuid(),
    color: item.color ?? nextOrbitColor(index),
    visible: item.visible !== false,
  }));
}

function applyWorkbenchSnapshot(snapshot = {}) {
  state.orbits = buildOrbitRecordsFromSerialized(snapshot.orbits ?? []);
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
    state.overlays = { ...state.overlays, ...snapshot.overlays };
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

function metricRow(label, value, unit = '') {
  const content = unit
    ? `<dd class="metrics-value"><span>${value}</span><span class="metrics-unit">${unit}</span></dd>`
    : `<dd>${value}</dd>`;
  return `<div><dt>${label}</dt>${content}</div>`;
}

function saveState() {
  const payload = {
    version: 2,
    selectedIds: [...state.selectedIds],
    selectedId: state.selectedId,
    frame: state.frame,
    centerBody: state.centerBody,
    perturbationModel: state.perturbationModel,
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
    exportNamePrefix: state.exportNamePrefix,
    currentAssetId: state.currentAssetId,
    isSceneDirty: state.isSceneDirty,
    orbits: state.orbits.map(serializeOrbit),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  saveAssetLibrary();
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (payload?.overlays) {
      const restoredOverlays = { ...payload.overlays };
      if (typeof restoredOverlays.equator === 'boolean' && typeof restoredOverlays.ecliptic !== 'boolean') {
        restoredOverlays.ecliptic = restoredOverlays.equator;
      }
      state.overlays = { ...state.overlays, ...restoredOverlays };
      for (const [key, input] of Object.entries(els.toggles)) {
        if (input) input.checked = Boolean(state.overlays[key]);
      }
    }
    if (payload?.modulePins && typeof payload.modulePins === 'object') {
      state.modulePins = { ...state.modulePins, ...payload.modulePins };
    } else if (payload?.workbench) {
      state.modulePins.workbench = payload.workbench.pinned !== false;
    }
    if (typeof payload?.activeModule === 'string') {
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
    if (typeof payload?.exportNamePrefix === 'string') state.exportNamePrefix = payload.exportNamePrefix;
    if (typeof payload?.currentAssetId === 'string') state.currentAssetId = payload.currentAssetId;
    if (typeof payload?.isSceneDirty === 'boolean') state.isSceneDirty = payload.isSceneDirty;
    if (['two-body', 'j2', 'j3'].includes(payload?.perturbationModel)) {
      state.perturbationModel = payload.perturbationModel;
    }
    if (Array.isArray(payload?.orbits)) {
      state.orbits = buildOrbitRecordsFromSerialized(payload.orbits);
      setSelectedOrbitIds(
        Array.isArray(payload.selectedIds) ? payload.selectedIds : payload.selectedId ? [payload.selectedId] : [],
        { currentId: payload.selectedId, defaultFirst: true },
      );
    }
  } catch (error) {
    console.warn('Failed to restore local orbit state:', error);
  }
}

function buildOrbitRecord(rawElements, options = {}) {
  const orbit = computeOrbit(rawElements);
  const name = rawElements.name?.trim() || `Orbit ${state.orbits.length + 1}`;
  return {
    id: options.id ?? uuid(),
    name,
    color: normalizeHexColor(options.color, nextOrbitColor(state.orbits.length)),
    visible: options.visible ?? true,
    orbit,
  };
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
}

function getFormColor() {
  return normalizeHexColor(els.color.hex.value, nextOrbitColor(state.orbits.length));
}

function setNextFormColor() {
  setColorFields(nextOrbitColor(state.orbits.length));
}

function fillForm(record) {
  const elements = record.orbit.elements;
  els.form.elements.name.value = record.name;
  els.form.elements.semiMajorAxisKm.value = elements.semiMajorAxisKm;
  els.form.elements.eccentricity.value = elements.eccentricity;
  els.form.elements.inclinationDeg.value = elements.inclinationDeg;
  els.form.elements.raanDeg.value = elements.raanDeg;
  els.form.elements.argPeriapsisDeg.value = elements.argPeriapsisDeg;
  els.form.elements.trueAnomalyDeg.value = elements.trueAnomalyDeg;
  setColorFields(record.color);
  state.editingId = record.id;
  els.submitButton.textContent = '更新轨迹';
  clearErrors();
}

function resetForm() {
  els.form.reset();
  state.editingId = null;
  els.submitButton.textContent = '生成轨迹';
  setNextFormColor();
  clearErrors();
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
  if (id === null) {
    state.groundTrackHistories.clear();
  } else {
    state.groundTrackHistories.delete(id);
  }
  state.groundTrackTracks = [];
  renderGroundTrackStats();
}

function removeOrbit(id) {
  state.orbits = state.orbits.filter((orbit) => orbit.id !== id);
  clearGroundTrackHistories(id);
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

function formatVectorTuple(vector, digits = 2) {
  return `(${formatNumber(vector.x, digits)}, ${formatNumber(vector.y, digits)}, ${formatNumber(vector.z, digits)})`;
}

function perturbationLabel(value = state.perturbationModel) {
  return {
    'two-body': '无摄动（二体运动）',
    j2: 'J2 摄动',
    j3: 'J3 摄动',
  }[value] ?? '无摄动（二体运动）';
}

function updateStatusSelections() {
  els.frameValue.textContent = state.frame;
  els.bodyValue.textContent = '地球';
  els.bodyValue.title = perturbationLabel();
  for (const button of document.querySelectorAll('[data-frame-option]')) {
    button.classList.toggle('is-active', button.dataset.frameOption === state.frame);
  }
  for (const button of document.querySelectorAll('[data-perturbation-model]')) {
    button.classList.toggle('is-active', button.dataset.perturbationModel === state.perturbationModel);
  }
  for (const button of document.querySelectorAll('[data-body-option]')) {
    button.classList.toggle('is-active', button.dataset.bodyOption === state.centerBody);
  }
}

function closeStatusCards(exceptCard = null) {
  for (const card of document.querySelectorAll('.status-card.is-open, .status-card.is-click-closed')) {
    if (card !== exceptCard) card.classList.remove('is-open', 'is-click-closed');
  }
}

function toggleStatusCard(card) {
  const shouldOpen = !card.classList.contains('is-open');
  closeStatusCards(card);
  card.classList.toggle('is-open', shouldOpen);
  card.classList.toggle('is-click-closed', !shouldOpen);
  card.focus({ preventScroll: true });
}

function moduleKind(moduleName) {
  if (SIDE_MODULES.has(moduleName)) return 'side';
  if (BOTTOM_MODULES.has(moduleName)) return 'bottom';
  if (moduleName === 'info') return 'modal';
  return 'none';
}

function closeInfoModal() {
  els.infoModal.hidden = true;
}

function activeSideModule() {
  return SIDE_MODULES.has(state.activeModule) ? state.activeModule : null;
}

function applyModuleState() {
  const active = state.activeModule;
  const sideOpen = Boolean(activeSideModule());
  els.body.classList.toggle('side-panel-open', sideOpen);
  els.body.classList.toggle('module-previewing', Boolean(state.previewModule));
  for (const moduleName of ['workbench', 'assets', 'settings', 'groundTrack', 'console']) {
    els.body.classList.toggle(`module-${moduleName}-open`, active === moduleName);
  }

  for (const button of els.moduleButtons) {
    const moduleName = button.dataset.moduleNav;
    button.classList.toggle('is-active', moduleName === active);
    button.classList.toggle('is-preview', moduleName === state.previewModule);
  }

  for (const panel of els.modulePanels) {
    panel.classList.toggle('is-open', panel.dataset.modulePanel === active);
  }

  for (const pinButton of els.modulePinButtons) {
    const moduleName = pinButton.dataset.modulePin;
    const isPinned = Boolean(state.modulePins[moduleName]);
    pinButton.classList.toggle('is-pinned', isPinned);
    pinButton.setAttribute('aria-pressed', String(isPinned));
  }

  els.closeDrawer.setAttribute('aria-expanded', String(active === 'workbench'));
  els.groundTrackPanel.classList.toggle('is-open', active === 'groundTrack' && state.groundTrackPanel !== 'minimized');
  els.groundTrackPanel.classList.toggle('is-minimized', state.groundTrackPanel === 'minimized');
  els.consolePanel.classList.toggle('is-open', active === 'console');
  els.infoModal.hidden = active !== 'info';
  groundTrackView.setPanelOpen(active === 'groundTrack' && state.groundTrackPanel !== 'minimized');
  groundTrackView.setFullscreen(state.groundTrackPanel === 'fullscreen');
}

function openModule(moduleName, { preview = false } = {}) {
  if (!moduleName) return;
  clearTimeout(state.hoverPreviewTimer);
  state.hoverPreviewTimer = null;
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

  if (moduleName === 'groundTrack' && ['closed', 'minimized'].includes(state.groundTrackPanel)) state.groundTrackPanel = 'window';
  if (moduleName === 'console') closeInfoModal();
  if (moduleName === 'info') {
    state.groundTrackPanel = state.groundTrackPanel === 'minimized' ? 'minimized' : state.groundTrackPanel;
  }
  applyModuleState();
  if (moduleName === 'groundTrack') {
    syncGroundTrackHistories();
    renderGroundTrack({ force: true });
  }
  saveState();
}

function closeActiveModule() {
  if (!state.activeModule) return;
  if (state.activeModule === 'groundTrack') {
    setGroundTrackPanel('closed');
    return;
  }
  if (state.activeModule === 'info') closeInfoModal();
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
  if (moduleName === 'groundTrack' && state.groundTrackPanel === 'minimized') {
    setGroundTrackPanel('window', { confirmClose: false });
    return;
  }
  if (state.activeModule === moduleName && !state.previewModule) {
    closeActiveModule();
    return;
  }
  openModule(moduleName);
}

function startModulePreview(moduleName) {
  clearTimeout(state.hoverPreviewTimer);
  state.hoverPreviewTimer = setTimeout(() => {
    if (state.activeModule === moduleName) return;
    openModule(moduleName, { preview: true });
  }, 2000);
}

function renderMetrics() {
  const selected = selectedOrbitRecord();
  if (!selected) {
    els.selectedOrbitName.textContent = '未选择';
    els.metrics.innerHTML = `
      ${metricRow('周期', '--')}
      ${metricRow('近地点高度', '--', 'km')}
      ${metricRow('远地点高度', '--', 'km')}
      ${metricRow('速度范围', '--', 'km/s')}
      ${metricRow('ECI 位置', '--', 'km')}
      ${metricRow('ECI 速度', '--', 'km/s')}
    `;
    return;
  }

  const orbit = selected.orbit;
  const current = propagateOrbit(orbit, state.elapsedSeconds, { perturbationModel: state.perturbationModel });
  els.selectedOrbitName.textContent = state.selectedIds.length > 1
    ? `${selected.name} 等 ${state.selectedIds.length} 条`
    : selected.name;
  els.metrics.innerHTML = `
    ${metricRow('周期', formatDuration(orbit.periodSeconds))}
    ${metricRow('近地点高度', `${formatNumber(orbit.periapsisAltitudeKm, 3)}`, 'km')}
    ${metricRow('远地点高度', `${formatNumber(orbit.apoapsisAltitudeKm, 3)}`, 'km')}
    ${metricRow('速度范围', `${formatNumber(orbit.speedRangeKmS.min, 4)} - ${formatNumber(orbit.speedRangeKmS.max, 4)}`, 'km/s')}
    ${metricRow('ECI 位置', formatVectorTuple(current.positionKm, 2), 'km')}
    ${metricRow('ECI 速度', formatVectorTuple(current.velocityKmS, 4), 'km/s')}
  `;
}

function renderOrbitList() {
  els.orbitList.innerHTML = '';
  if (state.orbits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '当前没有轨道。填写六要素后生成第一条轨迹。';
    els.orbitList.append(empty);
    return;
  }

  for (const record of state.orbits) {
    const item = document.createElement('div');
    const isSelected = isOrbitSelected(record.id);
    const isMuted = state.selectedIds.length > 0 && !isSelected;
    item.className = `orbit-item${isSelected ? ' is-selected' : ''}${isMuted ? ' is-muted' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.backgroundColor = record.color;

    const main = document.createElement('button');
    main.className = 'orbit-main';
    main.type = 'button';
    main.innerHTML = `<strong>${record.name}</strong><span>a ${formatNumber(record.orbit.elements.semiMajorAxisKm, 0)} km · e ${formatNumber(record.orbit.elements.eccentricity, 4)} · i ${formatNumber(record.orbit.elements.inclinationDeg, 2)} °</span>`;
    main.addEventListener('click', () => {
      const selected = toggleOrbitSelection(record.id);
      const current = selectedOrbitRecord();
      if (selected) fillForm(record);
      else if (current) fillForm(current);
      else resetForm();
    });

    const actions = document.createElement('div');
    actions.className = 'orbit-actions';

    const visibility = document.createElement('button');
    visibility.className = 'mini-button';
    visibility.type = 'button';
    visibility.title = record.visible ? '隐藏轨道' : '显示轨道';
    visibility.textContent = record.visible ? '●' : '○';
    visibility.addEventListener('click', () => toggleOrbitVisibility(record.id));

    const edit = document.createElement('button');
    edit.className = 'mini-button';
    edit.type = 'button';
    edit.title = '编辑参数';
    edit.textContent = '✎';
    edit.addEventListener('click', () => {
      selectOrbit(record.id);
      fillForm(record);
    });

    const remove = document.createElement('button');
    remove.className = 'mini-button';
    remove.type = 'button';
    remove.title = '删除轨道';
    remove.textContent = '×';
    remove.addEventListener('click', () => removeOrbit(record.id));

    actions.append(visibility, edit, remove);
    item.append(dot, main, actions);
    els.orbitList.append(item);
  }
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

  for (const record of visibleOrbits) {
    const button = document.createElement('button');
    button.className = `status-option status-orbit-choice${isOrbitSelected(record.id) ? ' is-active' : ''}`;
    button.type = 'button';
    button.dataset.statusOrbitId = record.id;

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.backgroundColor = record.color;
    const name = document.createElement('span');
    name.textContent = record.name;

    button.append(dot, name);
    button.addEventListener('click', () => {
      const selected = toggleOrbitSelection(record.id);
      const current = selectedOrbitRecord();
      if (selected) fillForm(record);
      else if (current) fillForm(current);
      else resetForm();
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

function showOrbitTooltip(payload) {
  if (!payload?.orbitRecord) {
    els.orbitTooltip.hidden = true;
    return;
  }
  const { orbitRecord, clientX, clientY } = payload;
  els.orbitTooltip.innerHTML = orbitTooltipHtml(orbitRecord);
  els.orbitTooltip.style.setProperty('--orbit-tooltip-color', orbitRecord.color);
  els.orbitTooltip.hidden = false;

  const margin = 16;
  const rect = els.orbitTooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - margin, clientX + 18);
  const top = Math.min(window.innerHeight - rect.height - margin, clientY + 18);
  els.orbitTooltip.style.left = `${Math.max(margin, left)}px`;
  els.orbitTooltip.style.top = `${Math.max(margin, top)}px`;
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
}

function syncSettingsControls() {
  els.performanceMode.value = state.performanceMode;
  els.customMemory.value = String(state.customMemoryGb);
  els.exportNamePrefix.value = state.exportNamePrefix;
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
  els.groundTrackFilterList.innerHTML = '';
  const visibleOrbits = state.orbits.filter((orbit) => orbit.visible);
  if (visibleOrbits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '暂无可见轨道';
    els.groundTrackFilterList.append(empty);
    return;
  }

  for (const record of visibleOrbits) {
    const label = document.createElement('label');
    label.className = 'ground-track-filter-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.groundTrackFilters[record.id] !== false;
    input.dataset.groundTrackFilter = record.id;

    const name = document.createElement('span');
    name.textContent = record.name;

    const swatch = document.createElement('span');
    swatch.className = 'ground-track-color-swatch';
    swatch.style.color = record.color;

    input.addEventListener('change', () => {
      state.groundTrackFilters[record.id] = input.checked;
      if (!input.checked) clearGroundTrackHistories(record.id);
      markSceneDirty();
      syncGroundTrackHistories();
      renderGroundTrack({ force: true });
      saveState();
    });

    label.append(input, name, swatch);
    els.groundTrackFilterList.append(label);
  }
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

function groundTrackReferenceSampleCount(orbitRecord, budget) {
  return orbitReferenceSampleCount(orbitRecord.orbit, budget.max3dReferenceSamples);
}

function activeGroundTrackRecords(budget) {
  syncGroundTrackFilters();
  return state.orbits
    .filter((orbit) => orbit.visible && state.groundTrackFilters[orbit.id] !== false)
    .slice(0, budget.mapCacheTracks);
}

function rebuildGroundTrackTracksFromCache(records = null) {
  const budget = currentGroundTrackBudget();
  const activeRecords = records ?? activeGroundTrackRecords(budget);
  const window = currentGroundTrackWindow();
  state.groundTrackTracks = activeRecords
    .map((orbitRecord) => {
      const history = state.groundTrackHistories.get(orbitRecord.id);
      return history ? groundTrackTrackFromHistory(history, orbitRecord, window) : null;
    })
    .filter(Boolean);
  return state.groundTrackTracks;
}

function syncGroundTrackHistories() {
  if (state.groundTrackPanel === 'closed') {
    state.groundTrackTracks = [];
    return;
  }
  const budget = currentGroundTrackBudget();
  const activeRecords = activeGroundTrackRecords(budget);
  const activeIds = new Set(activeRecords.map((orbit) => orbit.id));
  const startUtcMs = utcMsFromInput(state.simulationStartUtc, Date.now());
  const window = currentGroundTrackWindow();

  for (const id of state.groundTrackHistories.keys()) {
    if (!activeIds.has(id)) state.groundTrackHistories.delete(id);
  }

  for (const orbitRecord of activeRecords) {
    const history = updateGroundTrackHistory(state.groundTrackHistories.get(orbitRecord.id), {
      orbitRecord,
      elapsedSeconds: state.elapsedSeconds,
      startUtcMs,
      perturbationModel: state.perturbationModel,
      referenceSampleCount: groundTrackReferenceSampleCount(orbitRecord, budget),
      window,
      maxCatchUpPoints: Math.max(60, Math.floor(budget.maxGroundTrackSamples / Math.max(1, activeRecords.length))),
    });
    state.groundTrackHistories.set(orbitRecord.id, history);
  }

  rebuildGroundTrackTracksFromCache(activeRecords);
}

function pruneGroundTrackHistoriesToWindow() {
  const window = currentGroundTrackWindow();
  for (const history of state.groundTrackHistories.values()) {
    pruneGroundTrackHistory(history, window, state.elapsedSeconds);
  }
  rebuildGroundTrackTracksFromCache();
}

function renderGroundTrackStats(stats = null) {
  if (!stats) {
    els.groundTrackStats.textContent = '框选地图区域后显示统计。';
    return;
  }
  if (stats.totalPointCount === 0) {
    els.groundTrackStats.innerHTML = '<div class="empty-list">当前区域没有星下点轨迹经过。</div>';
    return;
  }

  els.groundTrackStats.innerHTML = stats.items.map((item) => `
    <article class="ground-track-stat-item">
      <span class="color-dot" style="background:${escapeHtml(item.color)}"></span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${formatNumber(item.pointCount, 0)} 点 · ${escapeHtml(item.perturbationModel)}</span>
        <small>${formatUtc(item.earliestUtcMs)} - ${formatUtc(item.latestUtcMs)}</small>
        <small>经度 ${formatNumber(item.westDeg, 2)}° ~ ${formatNumber(item.eastDeg, 2)}° · 纬度 ${formatNumber(item.southDeg, 2)}° ~ ${formatNumber(item.northDeg, 2)}°</small>
      </div>
    </article>
  `).join('');
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
  els.assetGroupName.value = activeGroup?.name ?? els.assetGroupName.value;
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
    row.className = `asset-group-row${group.id === state.currentAssetId ? ' is-active' : ''}`;

    const main = document.createElement('button');
    main.className = 'orbit-main';
    main.type = 'button';
    main.innerHTML = `<strong>${escapeHtml(group.name)}</strong><span>${group.snapshot?.orbits?.length ?? 0} 条轨道 · ${escapeHtml(formatUtc(group.updatedAt))}</span>`;
    main.addEventListener('click', () => loadAssetGroup(group.id));

    const exportButton = document.createElement('button');
    exportButton.className = 'mini-button';
    exportButton.type = 'button';
    exportButton.title = '导出 JSON';
    exportButton.textContent = '⇩';
    exportButton.addEventListener('click', () => {
      downloadText(`${group.name || 'orbit-group'}-${currentTimestampLabel()}.json`, JSON.stringify({
        version: 1,
        snapshot: group.snapshot,
      }, null, 2));
    });

    const renameButton = document.createElement('button');
    renameButton.className = 'mini-button';
    renameButton.type = 'button';
    renameButton.title = '重命名';
    renameButton.textContent = '✎';
    renameButton.addEventListener('click', () => renameAssetGroup(group.id));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'mini-button';
    deleteButton.type = 'button';
    deleteButton.title = '删除';
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', () => deleteAssetGroup(group.id));

    row.append(main, exportButton, renameButton, deleteButton);
    els.assetGroupList.append(row);
  }
}

function saveCurrentAssetGroup() {
  const name = els.assetGroupName.value.trim() || activeAssetGroup()?.name || `轨道组 ${state.assetGroups.length + 1}`;
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

function loadAssetGroup(id) {
  const group = state.assetGroups.find((item) => item.id === id);
  if (!group) return;
  if (state.isSceneDirty && !window.confirm('当前轨道组有未保存修改，切换会丢弃这些修改。是否继续？')) return;
  applyWorkbenchSnapshot(group.snapshot);
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
  state.orbits = [];
  setSelectedOrbitIds([]);
  state.editingId = null;
  state.elapsedSeconds = 0;
  state.currentAssetId = null;
  state.isSceneDirty = false;
  clearGroundTrackHistories();
  resetForm();
  renderUi();
  saveState();
}

function applyGroundTrackPanelState() {
  const isOpen = state.activeModule === 'groundTrack' && !['closed', 'minimized'].includes(state.groundTrackPanel);
  const isFullscreen = state.groundTrackPanel === 'fullscreen';
  els.groundTrackPanel.classList.toggle('is-open', isOpen);
  els.groundTrackPanel.classList.toggle('is-fullscreen', isFullscreen);
  els.groundTrackPanel.classList.toggle('is-minimized', state.groundTrackPanel === 'minimized');
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
  if (nextMode === 'closed') {
    clearGroundTrackHistories();
    if (state.activeModule === 'groundTrack') {
      state.activeModule = null;
      state.committedModule = null;
    }
  } else {
    state.activeModule = 'groundTrack';
    state.committedModule = 'groundTrack';
  }
  applyGroundTrackPanelState();
  applyModuleState();
  const shouldDraw = !['closed', 'minimized'].includes(state.groundTrackPanel);
  if (shouldDraw) {
    syncGroundTrackHistories();
    requestAnimationFrame(() => renderGroundTrack({ force: true }));
  }
  saveState();
}

function renderGroundTrack(options = {}) {
  const isOpen = state.activeModule === 'groundTrack' && !['closed', 'minimized'].includes(state.groundTrackPanel);
  groundTrackView.setPanelOpen(isOpen);
  groundTrackView.setFullscreen(state.groundTrackPanel === 'fullscreen');
  if (!isOpen) return;

  const nowMs = performance.now();
  const minIntervalMs = state.isPlaying ? 240 : 800;
  if (!options.force && nowMs - state.lastGroundTrackRenderMs < minIntervalMs) {
    groundTrackView.setData(state.groundTrackTracks, {
      selectedIds: state.selectedIds,
      elapsedSeconds: state.elapsedSeconds,
      isPlaying: state.isPlaying,
    });
    return;
  }

  state.lastGroundTrackRenderMs = nowMs;
  rebuildGroundTrackTracksFromCache();
  groundTrackView.setData(state.groundTrackTracks, {
    selectedIds: state.selectedIds,
    elapsedSeconds: state.elapsedSeconds,
    isPlaying: state.isPlaying,
  });
}

function exportGroundTrackPng() {
  syncGroundTrackHistories();
  rebuildGroundTrackTracksFromCache();
  groundTrackView.setData(state.groundTrackTracks, {
    selectedIds: state.selectedIds,
    elapsedSeconds: state.elapsedSeconds,
    isPlaying: false,
  });
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
  const scenePng = scene.capturePng();
  const shouldIncludeMap = state.activeModule === 'groundTrack' && !['closed', 'minimized'].includes(state.groundTrackPanel);
  if (!shouldIncludeMap) return scenePng;

  const mapPng = groundTrackView.capturePng();
  if (state.groundTrackPanel === 'fullscreen') return mapPng;

  const [sceneImage, mapImage] = await Promise.all([
    loadImageFromDataUrl(scenePng),
    loadImageFromDataUrl(mapPng),
  ]);
  const sceneRect = els.canvas.getBoundingClientRect();
  const mapRect = els.groundTrackCanvas.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sceneRect.width));
  canvas.height = Math.max(1, Math.round(sceneRect.height));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sceneImage, 0, 0, canvas.width, canvas.height);

  const x = Math.max(0, Math.round(mapRect.left - sceneRect.left));
  const y = Math.max(0, Math.round(mapRect.top - sceneRect.top));
  const width = Math.min(canvas.width - x, Math.round(mapRect.width));
  const height = Math.min(canvas.height - y, Math.round(mapRect.height));
  ctx.fillStyle = 'rgba(7, 16, 22, 0.94)';
  ctx.fillRect(Math.max(0, x - 10), Math.max(0, y - 10), Math.min(canvas.width, width + 20), Math.min(canvas.height, height + 20));
  ctx.drawImage(mapImage, x, y, width, height);
  ctx.strokeStyle = 'rgba(86, 140, 135, 0.72)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  return canvas.toDataURL('image/png');
}

function renderUi() {
  els.orbitCount.textContent = String(state.orbits.filter((orbit) => orbit.visible).length);
  els.orbitListCount.textContent = `${state.orbits.length} 条`;
  els.emptyState.classList.toggle('is-hidden', state.orbits.length > 0);
  els.playToggle.disabled = state.isPlaying;
  els.pauseButton.disabled = !state.isPlaying;
  updateTimeReadout();
  applyModuleState();
  updateStatusSelections();
  renderOrbitList();
  renderStatusOrbitMenu();
  renderMetrics();
  syncOverlayControlsFromState();
  scene.setFrame(state.frame);
  scene.setOverlayVisibility(state.overlays);
  scene.syncOrbits(state.orbits, state.perturbationModel);
  scene.setSelectedOrbits(state.selectedIds);
  syncGroundTrackControlsFromState();
  syncGroundTrackOptionControls();
  syncSettingsControls();
  currentGroundTrackBudget();
  applyGroundTrackPanelState();
  renderGroundTrackFilters();
  renderAssetLibrary();
  syncGroundTrackHistories();
  renderGroundTrack({ force: true });
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
    applyWorkbenchSnapshot(snapshot);
    state.currentAssetId = null;
    state.isSceneDirty = true;
    clearGroundTrackHistories();
    renderUi();
    saveState();
  } catch (error) {
    showErrors(`导入失败：${error.message}`);
  } finally {
    els.importJson.value = '';
  }
}

async function importTxt(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseOrbitText(text);
    const imported = parsed.map((item, index) => buildOrbitRecord(item, {
      id: uuid(),
      color: nextOrbitColor(index),
      visible: true,
    }));
    state.orbits = imported;
    setSelectedOrbitIds(imported[0] ? [imported[0].id] : [], { currentId: imported[0]?.id ?? null });
    state.editingId = null;
    state.currentAssetId = null;
    state.isSceneDirty = true;
    clearGroundTrackHistories();
    resetForm();
    renderUi();
    saveState();
  } catch (error) {
    showErrors(`导入 TXT 失败：${error.message}`);
  } finally {
    els.importTxt.value = '';
  }
}

function bindEvents() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.status-card')) closeStatusCards();
    if (!target.closest('#simulation-run-control')) setRunLimitMenuOpen(false);
    const moduleSurface = target.closest('.side-module-panel, .ground-track-panel, .bottom-module-panel, .module-sidebar, .info-dialog, #simulation-run-control, .bottom-console');
    if (!moduleSurface && state.activeModule && !state.modulePins[state.activeModule]) closeActiveModule();
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

  for (const card of document.querySelectorAll('.status-card')) {
    card.addEventListener('click', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      if (event.target instanceof Element && event.target.closest('.status-menu')) return;
      toggleStatusCard(card);
    });
    card.addEventListener('pointerleave', () => {
      card.classList.remove('is-click-closed');
    });
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
      if (state.perturbationModel !== button.dataset.perturbationModel) {
        state.perturbationModel = button.dataset.perturbationModel;
        clearGroundTrackHistories();
        markSceneDirty();
      }
      renderUi();
      closeStatusCards();
      saveState();
    });
  }

  els.closeDrawer.addEventListener('click', closeActiveModule);

  els.color.picker.addEventListener('input', () => setColorFields(els.color.picker.value));
  els.color.hex.addEventListener('input', () => {
    if (/^#?[\da-f]{6}$/i.test(els.color.hex.value.trim())) setColorFields(els.color.hex.value);
  });
  for (const input of [els.color.r, els.color.g, els.color.b]) {
    input.addEventListener('input', () => {
      setColorFields(rgbToHex(els.color.r.value, els.color.g.value, els.color.b.value));
    });
  }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const raw = formToElements();
      const existingIndex = state.orbits.findIndex((orbit) => orbit.id === state.editingId);
      const record = buildOrbitRecord(raw, {
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
      clearErrors();
      resetForm();
      renderUi();
      saveState();
    } catch (error) {
      showErrors(error.errors ?? error.message);
    }
  });

  els.clearForm.addEventListener('click', resetForm);
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
  els.pauseButton.addEventListener('click', pausePlayback);
  els.resetTime.addEventListener('click', () => {
    state.elapsedSeconds = 0;
    clearGroundTrackHistories();
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
  els.speedFactor.addEventListener('change', () => {
    state.speedFactor = Number(els.speedFactor.value);
  });
  els.timeReadoutPanel.addEventListener('dblclick', cycleSimulationTimeUnit);
  els.groundTrackModeToggle.addEventListener('click', () => {
    setGroundTrackPanel(state.groundTrackPanel === 'fullscreen' ? 'window' : 'fullscreen');
  });
  els.groundTrackMinimize.addEventListener('click', () => setGroundTrackPanel('minimized', { confirmClose: false }));
  els.groundTrackClose.addEventListener('click', () => setGroundTrackPanel('closed'));
  els.groundTrackResetView.addEventListener('click', () => groundTrackView.resetView());
  els.simulationStartUtc.addEventListener('change', () => {
    state.simulationStartUtc = els.simulationStartUtc.value || utcDatetimeLocalValue(new Date());
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
  els.infoClose.addEventListener('click', closeActiveModule);
  els.infoModal.addEventListener('pointerdown', (event) => {
    if (event.target === els.infoModal) closeActiveModule();
  });
  els.consoleClose.addEventListener('click', closeActiveModule);
  els.exitPage.addEventListener('click', () => {
    saveState();
    window.close();
  });
  els.screenshotButton.addEventListener('click', async () => {
    const png = await composeScreenshotDataUrl();
    downloadDataUrl(`eci-orbit-scene-${currentTimestampLabel()}.png`, png);
  });
  els.exportJson.addEventListener('click', exportJson);
  els.importJson.addEventListener('change', () => importJson(els.importJson.files[0]));
  els.importTxt.addEventListener('change', () => importTxt(els.importTxt.files[0]));
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
    renderGroundTrackStats(stats);
    groundTrackView.setSelectionStats(stats);
  });
  scene.setOrbitHoverCallback(showOrbitTooltip);
}

function tick(nowMs) {
  const deltaSeconds = Math.min(0.1, Math.max(0, (nowMs - state.lastFrameMs) / 1000));
  state.lastFrameMs = nowMs;
  if (state.isPlaying) {
    const elapsedRunSeconds = state.runStartedAtMs === null ? 0 : (nowMs - state.runStartedAtMs) / 1000;
    if (state.runLimitSeconds > 0 && elapsedRunSeconds >= state.runLimitSeconds) {
      state.isPlaying = false;
      state.runStartedAtMs = null;
      renderUi();
    } else {
      state.elapsedSeconds += deltaSeconds * state.speedFactor;
    }
  }
  updateTimeReadout();
  scene.update(state.orbits, state.elapsedSeconds, state.perturbationModel);
  if (state.orbits.length > 0) renderMetrics();
  syncGroundTrackHistories();
  if (state.groundTrackPanel !== 'closed') renderGroundTrack();
  requestAnimationFrame(tick);
}

if (!state.simulationStartUtc) state.simulationStartUtc = utcDatetimeLocalValue(new Date());
restoreAssetLibrary();
restoreState();
bindEvents();
setOverlaysFromInputs({ markDirty: false });
if (DEFAULT_ORBIT_COLORS.length > 0 && !state.editingId) setNextFormColor();
renderUi();
requestAnimationFrame(tick);
