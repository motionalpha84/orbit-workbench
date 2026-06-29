import { normalizePerturbationModel, propagateOrbit } from './orbit.mjs';

const DEFAULT_SAMPLE_COUNT = 160;
const MIN_SAMPLE_COUNT = 48;
const MAX_SAMPLE_COUNT = 720;
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;

function finiteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('标定矢量必须填写有限数字。');
  return number;
}

function safeFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vectorMagnitude(vector = {}) {
  return Math.hypot(
    safeFiniteNumber(vector.x),
    safeFiniteNumber(vector.y),
    safeFiniteNumber(vector.z),
  );
}

function vectorDistance(a = {}, b = {}) {
  return Math.hypot(
    safeFiniteNumber(a.x) - safeFiniteNumber(b.x),
    safeFiniteNumber(a.y) - safeFiniteNumber(b.y),
    safeFiniteNumber(a.z) - safeFiniteNumber(b.z),
  );
}

function finiteVector(vector = {}) {
  const parsed = {
    x: Number(vector.x),
    y: Number(vector.y),
    z: Number(vector.z),
  };
  return Number.isFinite(parsed.x) && Number.isFinite(parsed.y) && Number.isFinite(parsed.z)
    ? parsed
    : null;
}

function normalizeSampleCount(sampleCount) {
  const number = Math.floor(Number(sampleCount));
  if (!Number.isFinite(number)) return DEFAULT_SAMPLE_COUNT;
  return Math.min(MAX_SAMPLE_COUNT, Math.max(MIN_SAMPLE_COUNT, number));
}

function stateVector(state, mode) {
  return mode === 'velocity' ? state.velocityKmS : state.positionKm;
}

function isFiniteState(state) {
  return Boolean(finiteVector(state?.positionKm) && finiteVector(state?.velocityKmS));
}

function positionToleranceKm(targetVector, orbitRecord) {
  const scaleKm = Math.max(
    vectorMagnitude(targetVector),
    safeFiniteNumber(orbitRecord?.orbit?.elements?.semiMajorAxisKm),
    1,
  );
  return Math.max(1e-6 * scaleKm, 1e-3);
}

function velocityToleranceKmS(targetVector, state) {
  const scaleKmS = Math.max(vectorMagnitude(targetVector), vectorMagnitude(state?.velocityKmS), 1);
  return Math.max(1e-7 * scaleKmS, 1e-6);
}

function hitTolerance(mode, targetVector, orbitRecord, state) {
  return mode === 'velocity'
    ? velocityToleranceKmS(targetVector, state)
    : positionToleranceKm(targetVector, orbitRecord);
}

export function normalizeCalibrationMode(mode) {
  return mode === 'velocity' ? 'velocity' : 'position';
}

export function parseCalibrationVector(vector = {}) {
  return {
    x: finiteNumber(vector.x),
    y: finiteNumber(vector.y),
    z: finiteNumber(vector.z),
  };
}

export function calibrationResidual(state, targetVector, mode = 'position') {
  const vector = finiteVector(stateVector(state, normalizeCalibrationMode(mode)));
  const target = finiteVector(targetVector);
  if (!vector || !target) return Number.POSITIVE_INFINITY;
  return vectorDistance(vector, target);
}

function sampleState(orbitRecord, elapsedSeconds, perturbationModel, mode, targetVector) {
  try {
    const state = propagateOrbit(orbitRecord.orbit, elapsedSeconds, { perturbationModel });
    if (!isFiniteState(state)) return null;
    const residual = calibrationResidual(state, targetVector, mode);
    if (!Number.isFinite(residual)) return null;
    return {
      orbitId: orbitRecord.id,
      orbitName: orbitRecord.name,
      color: orbitRecord.color,
      elapsedSeconds,
      positionKm: state.positionKm,
      velocityKmS: state.velocityKmS,
      residual,
      tolerance: hitTolerance(mode, targetVector, orbitRecord, state),
      perturbationModel: state.perturbationModel,
    };
  } catch {
    return null;
  }
}

function goldenSectionMinimum(orbitRecord, left, right, perturbationModel, mode, targetVector) {
  let a = left;
  let b = right;
  let c = b - GOLDEN_RATIO * (b - a);
  let d = a + GOLDEN_RATIO * (b - a);
  let cState = sampleState(orbitRecord, c, perturbationModel, mode, targetVector);
  let dState = sampleState(orbitRecord, d, perturbationModel, mode, targetVector);

  for (let index = 0; index < 42; index += 1) {
    const cResidual = cState?.residual ?? Number.POSITIVE_INFINITY;
    const dResidual = dState?.residual ?? Number.POSITIVE_INFINITY;
    if (cResidual <= dResidual) {
      b = d;
      d = c;
      dState = cState;
      c = b - GOLDEN_RATIO * (b - a);
      cState = sampleState(orbitRecord, c, perturbationModel, mode, targetVector);
    } else {
      a = c;
      c = d;
      cState = dState;
      d = a + GOLDEN_RATIO * (b - a);
      dState = sampleState(orbitRecord, d, perturbationModel, mode, targetVector);
    }
  }

  const center = sampleState(orbitRecord, (a + b) / 2, perturbationModel, mode, targetVector);
  return [cState, dState, center]
    .filter(Boolean)
    .sort((first, second) => first.residual - second.residual)[0] ?? null;
}

function localMinimumIndices(samples) {
  if (samples.length === 0) return [];
  const indices = [];
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[index - 1] ?? samples[samples.length - 2];
    const current = samples[index];
    const next = samples[index + 1] ?? samples[1];
    if (!previous || !next) continue;
    if (current.residual <= previous.residual && current.residual <= next.residual) indices.push(index);
  }
  indices.sort((first, second) => samples[first].residual - samples[second].residual);
  return indices.slice(0, 12);
}

function normalizeElapsed(elapsedSeconds, periodSeconds) {
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return elapsedSeconds;
  const wrapped = elapsedSeconds % periodSeconds;
  return wrapped < 0 ? wrapped + periodSeconds : wrapped;
}

function isDuplicateHit(hit, existing, periodSeconds, mode) {
  const timeTolerance = Math.max(0.25, periodSeconds * 1e-5);
  return existing.some((item) => {
    if (item.orbitId !== hit.orbitId) return false;
    const direct = Math.abs(item.elapsedSeconds - hit.elapsedSeconds);
    const wrapped = Math.abs(periodSeconds - direct);
    const sameTime = Math.min(direct, wrapped) <= timeTolerance;
    const vectorResidual = mode === 'velocity'
      ? vectorDistance(item.velocityKmS, hit.velocityKmS)
      : vectorDistance(item.positionKm, hit.positionKm);
    return sameTime || vectorResidual <= Math.max(item.tolerance, hit.tolerance);
  });
}

function sortHits(first, second) {
  if (first.orbitName !== second.orbitName) return first.orbitName.localeCompare(second.orbitName, 'zh-CN');
  return first.elapsedSeconds - second.elapsedSeconds;
}

function normalizeTargetId(target, index) {
  const rawId = String(target?.id ?? '').trim();
  return rawId || `calibration-target-${index + 1}`;
}

function normalizeTargetName(target, index) {
  const rawName = String(target?.name ?? '').trim();
  return rawName || `标定${index + 1}`;
}

function targetInputError(targetId, targetName, mode, perturbationModel, error) {
  return {
    targetId,
    targetName,
    mode,
    result: {
      status: 'input-error',
      error,
      mode,
      targetVector: null,
      perturbationModel,
      hits: [],
      nearest: null,
    },
  };
}

function decorateStateWithTarget(state, targetId, targetName, mode) {
  if (!state) return null;
  return {
    ...state,
    targetId,
    targetName,
    targetMode: mode,
  };
}

function decorateResultWithTarget(result, targetId, targetName, mode) {
  const hits = Array.isArray(result.hits)
    ? result.hits.map((hit) => decorateStateWithTarget(hit, targetId, targetName, mode))
    : [];
  return {
    ...result,
    hits,
    nearest: decorateStateWithTarget(result.nearest, targetId, targetName, mode),
  };
}

export function calibrateOrbitVectors(records = [], options = {}) {
  const mode = normalizeCalibrationMode(options.mode);
  let targetVector;
  try {
    targetVector = parseCalibrationVector(options.targetVector);
  } catch (error) {
    return {
      status: 'input-error',
      error: error.message,
      mode,
      targetVector: null,
      perturbationModel: normalizePerturbationModel(options.perturbationModel),
      hits: [],
      nearest: null,
    };
  }

  const perturbationModel = normalizePerturbationModel(options.perturbationModel);
  const sampleCount = normalizeSampleCount(options.sampleCount);
  const visibleRecords = Array.isArray(records)
    ? records.filter((record) => record?.visible !== false && record?.orbit && Number.isFinite(record.orbit.periodSeconds))
    : [];

  if (visibleRecords.length === 0) {
    return { status: 'no-visible-orbits', mode, targetVector, perturbationModel, hits: [], nearest: null };
  }

  const hits = [];
  let nearest = null;

  for (const orbitRecord of visibleRecords) {
    const periodSeconds = orbitRecord.orbit.periodSeconds;
    const samples = [];
    for (let index = 0; index <= sampleCount; index += 1) {
      const elapsedSeconds = (index / sampleCount) * periodSeconds;
      const point = sampleState(orbitRecord, elapsedSeconds, perturbationModel, mode, targetVector);
      if (point) samples.push(point);
    }

    for (const sample of samples) {
      if (!nearest || sample.residual < nearest.residual) nearest = sample;
    }

    const indices = localMinimumIndices(samples);
    for (const index of indices) {
      const center = samples[index];
      const stepSeconds = periodSeconds / sampleCount;
      const refined = goldenSectionMinimum(
        orbitRecord,
        center.elapsedSeconds - stepSeconds,
        center.elapsedSeconds + stepSeconds,
        perturbationModel,
        mode,
        targetVector,
      );
      if (!refined) continue;
      refined.elapsedSeconds = normalizeElapsed(refined.elapsedSeconds, periodSeconds);
      if (!nearest || refined.residual < nearest.residual) nearest = refined;
      if (refined.residual <= refined.tolerance && !isDuplicateHit(refined, hits, periodSeconds, mode)) {
        hits.push(refined);
      }
    }
  }

  hits.sort(sortHits);
  return {
    status: hits.length > 0 ? 'hit' : nearest ? 'no-hit' : 'no-valid-states',
    mode,
    targetVector,
    perturbationModel,
    hits,
    nearest,
  };
}

export function calibrateOrbitVectorTargets(records = [], options = {}) {
  const perturbationModel = normalizePerturbationModel(options.perturbationModel);
  const sampleCount = options.sampleCount;
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const groupedTargets = [];
  const hits = [];
  let validTargetCount = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const targetId = normalizeTargetId(target, index);
    const targetName = normalizeTargetName(target, index);
    const mode = normalizeCalibrationMode(target?.mode);
    const explicitName = String(target?.name ?? '').trim();

    if (!explicitName) {
      groupedTargets.push(targetInputError(targetId, targetName, mode, perturbationModel, '标定名称不能为空。'));
      continue;
    }

    const result = calibrateOrbitVectors(records, {
      mode,
      targetVector: target?.vector,
      perturbationModel,
      sampleCount,
    });
    const decoratedResult = decorateResultWithTarget(result, targetId, targetName, mode);
    groupedTargets.push({
      targetId,
      targetName,
      mode,
      result: decoratedResult,
    });

    if (result.status !== 'input-error') validTargetCount += 1;
    hits.push(...decoratedResult.hits);
  }

  return {
    status: validTargetCount > 0 ? 'complete' : 'no-valid-targets',
    perturbationModel,
    targets: groupedTargets,
    hits,
  };
}
