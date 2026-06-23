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
  sampleGroundTrack,
  utcMsFromInput,
} from '../../js/groundtrack.mjs';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function selectedOrbitIds(input = {}) {
  return Array.isArray(input.selectedIds) ? new Set(input.selectedIds) : null;
}

export function createGroundTrackRenderData(input = {}) {
  const elapsedSeconds = finiteNumber(input.elapsedSeconds);
  const startUtcMs = utcMsFromInput(input.startUtcMs ?? input.startUtc, Date.now());
  const perturbationModel = normalizePerturbationModelValue(input.perturbationModel);
  const performance = normalizePerformanceOptions(input.performance);
  const window = normalizeGroundTrackWindow(input.window);
  const budget = groundTrackBudget(performance);
  const selectedIds = selectedOrbitIds(input);
  const activeOrbits = (Array.isArray(input.orbits) ? input.orbits : [])
    .filter((orbit) => orbit.visible !== false)
    .filter((orbit) => !selectedIds || selectedIds.has(orbit.id));
  const perOrbitMaxSamples = Math.max(120, Math.floor(budget.maxGroundTrackSamples / Math.max(1, activeOrbits.length)));

  return {
    version: API_VERSION,
    elapsedSeconds,
    startUtcMs,
    perturbationModel,
    window,
    performance,
    tracks: activeOrbits.map((orbitRecord) => sampleGroundTrack({
      orbitRecord,
      centerElapsedSeconds: elapsedSeconds,
      startUtcMs,
      perturbationModel,
      window,
      maxSamples: perOrbitMaxSamples,
    })),
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
