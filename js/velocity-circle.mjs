import {
  normalizePerturbationModel,
  propagateOrbit,
  vectorMagnitude,
} from './orbit.mjs';

const DEFAULT_SAMPLE_COUNT = 180;
const DEFAULT_TRAIL_SAMPLE_COUNT = 24;
const MIN_SAMPLE_COUNT = 12;
const MAX_SAMPLE_COUNT = 720;
const MIN_TRAIL_SAMPLE_COUNT = 2;
const MAX_TRAIL_SAMPLE_COUNT = 96;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteVector(vector = {}) {
  return {
    x: finiteNumber(vector.x),
    y: finiteNumber(vector.y),
    z: finiteNumber(vector.z),
  };
}

export function velocityMagnitudeKmS(vector = {}) {
  if (![vector.x, vector.y, vector.z].every((component) => Number.isFinite(Number(component)))) {
    return 0;
  }
  const safe = finiteVector(vector);
  return vectorMagnitude(safe);
}

export function velocityTrailSpanSeconds(orbit) {
  const periodSeconds = finiteNumber(orbit?.periodSeconds, 0);
  if (periodSeconds <= 0) return 120;
  return clamp(periodSeconds * 0.06, 90, 1800);
}

function normalizeSampleCount(sampleCount) {
  return clamp(Math.floor(finiteNumber(sampleCount, DEFAULT_SAMPLE_COUNT)), MIN_SAMPLE_COUNT, MAX_SAMPLE_COUNT);
}

function normalizeTrailSampleCount(sampleCount) {
  return clamp(
    Math.floor(finiteNumber(sampleCount, DEFAULT_TRAIL_SAMPLE_COUNT)),
    MIN_TRAIL_SAMPLE_COUNT,
    MAX_TRAIL_SAMPLE_COUNT,
  );
}

function velocityPoint(orbit, elapsedSeconds, perturbationModel) {
  const state = propagateOrbit(orbit, elapsedSeconds, { perturbationModel });
  const velocityKmS = finiteVector(state.velocityKmS);
  return {
    elapsedSeconds,
    velocityKmS,
    speedKmS: velocityMagnitudeKmS(velocityKmS),
    perturbationModel: state.perturbationModel,
  };
}

function hasOrbit(record) {
  return Boolean(record?.orbit && Number.isFinite(Number(record.orbit.periodSeconds)));
}

export function sampleVelocityCircle({
  orbitRecord,
  elapsedSeconds = 0,
  perturbationModel = 'two-body',
  sampleCount = DEFAULT_SAMPLE_COUNT,
  trailSampleCount = DEFAULT_TRAIL_SAMPLE_COUNT,
} = {}) {
  if (!hasOrbit(orbitRecord)) return null;
  const model = normalizePerturbationModel(perturbationModel);
  const safeElapsedSeconds = finiteNumber(elapsedSeconds);
  const count = normalizeSampleCount(sampleCount);
  const trailCount = normalizeTrailSampleCount(trailSampleCount);
  const periodSeconds = Math.max(1e-6, finiteNumber(orbitRecord.orbit.periodSeconds, 1));
  const trailSpanSeconds = velocityTrailSpanSeconds(orbitRecord.orbit);

  const samples = Array.from({ length: count + 1 }, (_, index) => {
    const sampleElapsedSeconds = safeElapsedSeconds + (index / count) * periodSeconds;
    return velocityPoint(orbitRecord.orbit, sampleElapsedSeconds, model);
  });

  const trail = Array.from({ length: trailCount }, (_, index) => {
    const fraction = trailCount === 1 ? 1 : index / (trailCount - 1);
    const sampleElapsedSeconds = safeElapsedSeconds - trailSpanSeconds * (1 - fraction);
    return velocityPoint(orbitRecord.orbit, sampleElapsedSeconds, model);
  });

  const current = velocityPoint(orbitRecord.orbit, safeElapsedSeconds, model);

  return {
    id: orbitRecord.id,
    name: orbitRecord.name,
    color: orbitRecord.color,
    orbit: orbitRecord.orbit,
    samples,
    current,
    trail,
    speedKmS: current.speedKmS,
    perturbationModel: model,
  };
}

export function sampleVelocityCircles(records = [], options = {}) {
  if (!Array.isArray(records)) return [];
  return records
    .map((orbitRecord) => sampleVelocityCircle({ orbitRecord, ...options }))
    .filter(Boolean);
}
