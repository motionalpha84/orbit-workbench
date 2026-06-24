import {
  API_VERSION,
  normalizeGroundTrackWindow,
  normalizePerformanceOptions,
  normalizePerturbationModelValue,
} from '../../shared/contracts.mjs';
import {
  groundTrackBudget,
  groundTrackCsv,
  groundTrackRegionStats,
  utcMsFromInput,
} from '../../js/groundtrack.mjs';
import {
  groundTrackTrackFromHistory,
  updateGroundTrackHistory,
} from '../../js/groundtrack-history.mjs';
import { orbitReferenceSampleCount } from './render-data-service.mjs';

const DEFAULT_HISTORY_KEY = 'default';
const MAX_HISTORY_GROUPS = 32;
const historyGroups = new Map();

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function selectedOrbitIds(input = {}) {
  return Array.isArray(input.selectedIds) ? new Set(input.selectedIds) : null;
}

function normalizedHistoryKey(input = {}) {
  return typeof input.historyKey === 'string' && input.historyKey.trim()
    ? input.historyKey.trim()
    : DEFAULT_HISTORY_KEY;
}

function historyGroupFor(key) {
  if (historyGroups.has(key)) return historyGroups.get(key);
  const group = new Map();
  historyGroups.set(key, group);
  while (historyGroups.size > MAX_HISTORY_GROUPS) {
    const oldestKey = historyGroups.keys().next().value;
    historyGroups.delete(oldestKey);
  }
  return group;
}

export function createGroundTrackRenderData(input = {}) {
  const elapsedSeconds = finiteNumber(input.elapsedSeconds);
  const startUtcMs = utcMsFromInput(input.startUtcMs ?? input.startUtc, Date.now());
  const perturbationModel = normalizePerturbationModelValue(input.perturbationModel);
  const performance = normalizePerformanceOptions(input.performance);
  const window = normalizeGroundTrackWindow(input.window);
  const budget = groundTrackBudget(performance);
  const selectedIds = selectedOrbitIds(input);
  const historyKey = normalizedHistoryKey(input);
  const histories = historyGroupFor(historyKey);
  const activeOrbits = (Array.isArray(input.orbits) ? input.orbits : [])
    .filter((orbit) => orbit.visible !== false)
    .filter((orbit) => !selectedIds || selectedIds.has(orbit.id))
    .slice(0, budget.mapCacheTracks);
  const activeIds = new Set(activeOrbits.map((orbit) => orbit.id));
  const maxCatchUpPoints = Math.max(60, Math.floor(budget.maxGroundTrackSamples / Math.max(1, activeOrbits.length)));

  for (const id of histories.keys()) {
    if (!activeIds.has(id)) histories.delete(id);
  }

  const tracks = activeOrbits.map((orbitRecord) => {
    const history = updateGroundTrackHistory(histories.get(orbitRecord.id), {
      orbitRecord,
      elapsedSeconds,
      startUtcMs,
      perturbationModel,
      referenceSampleCount: orbitReferenceSampleCount(orbitRecord.orbit, budget.max3dReferenceSamples),
      window,
      maxCatchUpPoints,
    });
    histories.set(orbitRecord.id, history);
    return groundTrackTrackFromHistory(history, orbitRecord, window);
  });

  return {
    version: API_VERSION,
    elapsedSeconds,
    startUtcMs,
    perturbationModel,
    window,
    performance,
    historyKey,
    tracks,
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
