import {
  API_VERSION,
  normalizeFrame,
  normalizePerformanceOptions,
  normalizePerturbationModelValue,
} from '../../shared/contracts.mjs';
import { groundTrackBudget } from '../../js/groundtrack.mjs';
import { EARTH_RADIUS_KM, propagateOrbit, sampleOrbit } from '../../js/orbit.mjs';

const EARTH_SCENE_RADIUS = 1;
const KM_TO_SCENE = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM;
const DEFAULT_TRAIL_POINTS = 130;
const REFERENCE_POINT_SPACING_SCENE = 0.028;
const MIN_REFERENCE_SAMPLES = 180;
const MAX_REFERENCE_SAMPLES = 2400;
const EARTH_SIDEREAL_DAY_SECONDS = 86164.0905;
const TWO_PI = Math.PI * 2;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vectorToScenePoint(positionKm) {
  return {
    x: positionKm.x * KM_TO_SCENE,
    y: positionKm.z * KM_TO_SCENE,
    z: -positionKm.y * KM_TO_SCENE,
  };
}

export function earthRotationAngleAt(elapsedSeconds) {
  const angle = (finiteNumber(elapsedSeconds) / EARTH_SIDEREAL_DAY_SECONDS) * TWO_PI;
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

export function frameAxesRotationAngleAt(frame, elapsedSeconds) {
  return frame === 'ECEF' ? earthRotationAngleAt(elapsedSeconds) : 0;
}

export function orbitReferenceSampleCount(orbit, maxSamples = MAX_REFERENCE_SAMPLES) {
  const a = orbit.elements.semiMajorAxisKm * KM_TO_SCENE;
  const b = a * Math.sqrt(1 - orbit.elements.eccentricity ** 2);
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const maximumSamples = Math.max(MIN_REFERENCE_SAMPLES, Math.floor(Number(maxSamples) || MAX_REFERENCE_SAMPLES));
  return Math.min(maximumSamples, Math.max(MIN_REFERENCE_SAMPLES, Math.round(perimeter / REFERENCE_POINT_SPACING_SCENE)));
}

function renderSample(sample) {
  return {
    elapsedSeconds: sample.elapsedSeconds,
    positionKm: sample.positionKm,
    velocityKmS: sample.velocityKmS,
    scenePoint: vectorToScenePoint(sample.positionKm),
  };
}

function tailSamplesForOrbit(orbit, elapsedSeconds, perturbationModel) {
  const period = orbit.periodSeconds;
  const tailSpan = Math.min(period * 0.22, Math.max(420, period * 0.1));
  return Array.from({ length: DEFAULT_TRAIL_POINTS }, (_, index) => {
    const fade = index / (DEFAULT_TRAIL_POINTS - 1);
    const t = finiteNumber(elapsedSeconds) - tailSpan * (1 - fade);
    const sample = propagateOrbit(orbit, t, { perturbationModel });
    return {
      ...renderSample(sample),
      alpha: 0.03 + fade ** 1.35 * 0.84,
      phase: fade,
    };
  });
}

export function createSceneRenderData(input = {}) {
  const elapsedSeconds = finiteNumber(input.elapsedSeconds);
  const perturbationModel = normalizePerturbationModelValue(input.perturbationModel);
  const frame = normalizeFrame(input.frame);
  const performance = normalizePerformanceOptions(input.performance);
  const budget = groundTrackBudget(performance);
  const maxReferenceSamples = Math.min(MAX_REFERENCE_SAMPLES, budget.max3dReferenceSamples);
  const visibleOrbits = (Array.isArray(input.orbits) ? input.orbits : []).filter((orbit) => orbit.visible !== false);

  return {
    version: API_VERSION,
    elapsedSeconds,
    perturbationModel,
    frame,
    performance,
    earthRotationAngleRad: earthRotationAngleAt(elapsedSeconds),
    frameAxesRotationAngleRad: frameAxesRotationAngleAt(frame, elapsedSeconds),
    orbits: visibleOrbits.map((orbitRecord) => {
      const referenceCount = orbitReferenceSampleCount(orbitRecord.orbit, maxReferenceSamples);
      const referencePoints = sampleOrbit(orbitRecord.orbit, referenceCount, { perturbationModel }).map(renderSample);
      const playbackSamples = sampleOrbit(orbitRecord.orbit, referenceCount, { perturbationModel }).map(renderSample);
      const current = renderSample(propagateOrbit(orbitRecord.orbit, elapsedSeconds, { perturbationModel }));
      return {
        id: orbitRecord.id,
        name: orbitRecord.name,
        color: orbitRecord.color,
        periodSeconds: orbitRecord.orbit.periodSeconds,
        visible: orbitRecord.visible !== false,
        referencePoints,
        playbackSamples,
        tailSamples: tailSamplesForOrbit(orbitRecord.orbit, elapsedSeconds, perturbationModel),
        current,
      };
    }),
  };
}
