export const MU_EARTH_KM3_S2 = 398600.4418;
export const EARTH_RADIUS_KM = 6378.137;
export const J2_EARTH = 1.08262668e-3;
export const J3_EARTH = -2.53215306e-6;
export const TWO_PI = Math.PI * 2;

const SUPPORTED_PERTURBATION_MODELS = new Set(['two-body', 'j2', 'j3']);

const ELEMENT_LABELS = {
  semiMajorAxis: 'a / km',
  eccentricity: 'e',
  inclination: 'i / °',
  raan: 'Ω / °',
  argPeriapsis: 'ω / °',
  trueAnomaly: 'ν / °',
};

export function formatElementLabel(key) {
  return ELEMENT_LABELS[key] ?? key;
}

export function degreesToRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

export function radiansToDegrees(radians) {
  return (Number(radians) * 180) / Math.PI;
}

export function normalizePerturbationModel(model) {
  return SUPPORTED_PERTURBATION_MODELS.has(model) ? model : 'two-body';
}

export function wrapRadians(angle) {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeElements(raw) {
  const semiMajorAxisKm = Number(raw.semiMajorAxisKm);
  const eccentricity = Number(raw.eccentricity);
  return {
    name: raw.name?.trim() || 'Unnamed orbit',
    semiMajorAxisKm,
    eccentricity,
    inclinationDeg: Number(raw.inclinationDeg),
    raanDeg: Number(raw.raanDeg),
    argPeriapsisDeg: Number(raw.argPeriapsisDeg),
    trueAnomalyDeg: Number(raw.trueAnomalyDeg),
    inclinationRad: degreesToRadians(raw.inclinationDeg),
    raanRad: degreesToRadians(raw.raanDeg),
    argPeriapsisRad: degreesToRadians(raw.argPeriapsisDeg),
    trueAnomalyRad: degreesToRadians(raw.trueAnomalyDeg),
  };
}

export function validateElements(raw) {
  const elements = normalizeElements(raw);
  const errors = [];

  if (!Number.isFinite(elements.semiMajorAxisKm) || elements.semiMajorAxisKm <= 0) {
    errors.push('半长轴 a 必须是大于 0 的 km 数值。');
  }

  if (!Number.isFinite(elements.eccentricity) || elements.eccentricity < 0) {
    errors.push('偏心率 e 必须是非负数。');
  } else if (elements.eccentricity >= 1) {
    errors.push('第一版仅支持椭圆轨道，要求 0 <= e < 1。');
  }

  for (const [key, label] of [
    ['inclinationDeg', '倾角 i'],
    ['raanDeg', '升交点赤经 Ω'],
    ['argPeriapsisDeg', '近地点幅角 ω'],
    ['trueAnomalyDeg', '真近点角 ν'],
  ]) {
    if (!Number.isFinite(elements[key])) {
      errors.push(`${label} 必须是有效角度，单位为 °。`);
    }
  }

  if (Number.isFinite(elements.semiMajorAxisKm) && Number.isFinite(elements.eccentricity)) {
    const periapsisRadiusKm = elements.semiMajorAxisKm * (1 - elements.eccentricity);
    if (periapsisRadiusKm <= EARTH_RADIUS_KM) {
      errors.push('近地点必须高于地球表面。');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    elements,
  };
}

function eccentricAnomalyFromTrueAnomaly(trueAnomalyRad, eccentricity) {
  if (eccentricity === 0) return wrapRadians(trueAnomalyRad);
  const factor = Math.sqrt((1 - eccentricity) / (1 + eccentricity));
  return wrapRadians(2 * Math.atan2(factor * Math.sin(trueAnomalyRad / 2), Math.cos(trueAnomalyRad / 2)));
}

function solveKepler(meanAnomalyRad, eccentricity) {
  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomalyRad : Math.PI;
  for (let i = 0; i < 18; i += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRad;
    const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly);
    eccentricAnomaly -= residual / derivative;
  }
  return wrapRadians(eccentricAnomaly);
}

function rotatePerifocalToEci(vector, elements) {
  const cosO = Math.cos(elements.raanRad);
  const sinO = Math.sin(elements.raanRad);
  const cosI = Math.cos(elements.inclinationRad);
  const sinI = Math.sin(elements.inclinationRad);
  const cosW = Math.cos(elements.argPeriapsisRad);
  const sinW = Math.sin(elements.argPeriapsisRad);

  const r11 = cosO * cosW - sinO * sinW * cosI;
  const r12 = -cosO * sinW - sinO * cosW * cosI;
  const r21 = sinO * cosW + cosO * sinW * cosI;
  const r22 = -sinO * sinW + cosO * cosW * cosI;
  const r31 = sinW * sinI;
  const r32 = cosW * sinI;

  return {
    x: r11 * vector.x + r12 * vector.y,
    y: r21 * vector.x + r22 * vector.y,
    z: r31 * vector.x + r32 * vector.y,
  };
}

function stateAtTrueAnomaly(elements, trueAnomalyRad) {
  const a = elements.semiMajorAxisKm;
  const e = elements.eccentricity;
  const semiLatusRectum = a * (1 - e * e);
  const radiusKm = semiLatusRectum / (1 + e * Math.cos(trueAnomalyRad));
  const sqrtMuOverP = Math.sqrt(MU_EARTH_KM3_S2 / semiLatusRectum);

  const positionPerifocal = {
    x: radiusKm * Math.cos(trueAnomalyRad),
    y: radiusKm * Math.sin(trueAnomalyRad),
    z: 0,
  };
  const velocityPerifocal = {
    x: -sqrtMuOverP * Math.sin(trueAnomalyRad),
    y: sqrtMuOverP * (e + Math.cos(trueAnomalyRad)),
    z: 0,
  };

  return {
    positionKm: rotatePerifocalToEci(positionPerifocal, elements),
    velocityKmS: rotatePerifocalToEci(velocityPerifocal, elements),
    radiusKm,
    trueAnomalyRad: wrapRadians(trueAnomalyRad),
  };
}

function stateAtMeanAnomaly(elements, meanAnomalyRad) {
  const e = elements.eccentricity;
  const eccentricAnomalyRad = solveKepler(wrapRadians(meanAnomalyRad), e);
  const trueAnomalyRad = e === 0
    ? eccentricAnomalyRad
    : wrapRadians(
      2 * Math.atan2(
        Math.sqrt(1 + e) * Math.sin(eccentricAnomalyRad / 2),
        Math.sqrt(1 - e) * Math.cos(eccentricAnomalyRad / 2),
      ),
    );

  return {
    ...stateAtTrueAnomaly(elements, trueAnomalyRad),
    meanAnomalyRad: wrapRadians(meanAnomalyRad),
    eccentricAnomalyRad,
  };
}

function withAngularDegreeFields(elements) {
  return {
    ...elements,
    inclinationDeg: radiansToDegrees(elements.inclinationRad),
    raanDeg: radiansToDegrees(elements.raanRad),
    argPeriapsisDeg: radiansToDegrees(elements.argPeriapsisRad),
    trueAnomalyDeg: typeof elements.trueAnomalyRad === 'number'
      ? radiansToDegrees(elements.trueAnomalyRad)
      : elements.trueAnomalyDeg,
  };
}

export function j2SecularRates(orbit) {
  const { semiMajorAxisKm: a, eccentricity: e, inclinationRad: i } = orbit.elements;
  const p = a * (1 - e * e);
  const ratioSquared = (EARTH_RADIUS_KM / p) ** 2;
  const cosI = Math.cos(i);
  const baseRate = J2_EARTH * orbit.meanMotionRadS * ratioSquared;

  return {
    raanRateRadS: -1.5 * baseRate * cosI,
    argPeriapsisRateRadS: 0.75 * baseRate * (5 * cosI * cosI - 1),
    meanAnomalyRateRadS: orbit.meanMotionRadS
      + 0.75 * baseRate * Math.sqrt(1 - e * e) * (3 * cosI * cosI - 1),
  };
}

function applyJ3LongPeriodCorrection(elements, meanAnomalyRad) {
  const p = elements.semiMajorAxisKm * (1 - elements.eccentricity * elements.eccentricity);
  const ratio = EARTH_RADIUS_KM / p;
  const sinI = Math.sin(elements.inclinationRad);
  const cosI = Math.cos(elements.inclinationRad);
  const argumentOfLatitude = elements.argPeriapsisRad + meanAnomalyRad;
  const sinU = Math.sin(argumentOfLatitude);
  const cosU = Math.cos(argumentOfLatitude);
  const scale = J3_EARTH * ratio ** 3;
  const latitudeShape = sinI * (5 * sinI * sinI * sinU * sinU - 3);
  const inclinationShape = cosI * (5 * sinI * sinI * sinU * sinU - 1);
  const eSafe = Math.max(elements.eccentricity, 1e-4);

  const eccentricity = clamp(
    elements.eccentricity - 0.35 * scale * latitudeShape * sinU,
    0,
    0.999999,
  );
  const inclinationRad = clamp(
    elements.inclinationRad + 0.2 * scale * inclinationShape * cosU,
    0,
    Math.PI,
  );
  const argPeriapsisRad = wrapRadians(
    elements.argPeriapsisRad + (scale * latitudeShape * cosU) / eSafe,
  );

  return {
    ...elements,
    eccentricity,
    inclinationRad,
    argPeriapsisRad,
  };
}

function propagatedElementsAndMeanAnomaly(orbit, elapsedSeconds, perturbationModel) {
  const model = normalizePerturbationModel(perturbationModel);
  const t = Number(elapsedSeconds) || 0;

  if (model === 'two-body') {
    return {
      elements: orbit.elements,
      meanAnomalyRad: wrapRadians(orbit.initialMeanAnomalyRad + orbit.meanMotionRadS * t),
    };
  }

  const rates = j2SecularRates(orbit);
  let elements = {
    ...orbit.elements,
    raanRad: wrapRadians(orbit.elements.raanRad + rates.raanRateRadS * t),
    argPeriapsisRad: wrapRadians(orbit.elements.argPeriapsisRad + rates.argPeriapsisRateRadS * t),
  };
  const meanAnomalyRad = wrapRadians(orbit.initialMeanAnomalyRad + rates.meanAnomalyRateRadS * t);

  if (model === 'j3') {
    elements = applyJ3LongPeriodCorrection(elements, meanAnomalyRad);
  }

  return {
    elements: withAngularDegreeFields(elements),
    meanAnomalyRad,
  };
}

export function computeOrbit(raw) {
  const validation = validateElements(raw);
  if (!validation.valid) {
    const error = new Error(validation.errors.join('\n'));
    error.errors = validation.errors;
    throw error;
  }

  const elements = validation.elements;
  const meanMotionRadS = Math.sqrt(MU_EARTH_KM3_S2 / elements.semiMajorAxisKm ** 3);
  const periodSeconds = TWO_PI / meanMotionRadS;
  const periapsisRadiusKm = elements.semiMajorAxisKm * (1 - elements.eccentricity);
  const apoapsisRadiusKm = elements.semiMajorAxisKm * (1 + elements.eccentricity);
  const periapsisSpeedKmS = Math.sqrt(MU_EARTH_KM3_S2 * (2 / periapsisRadiusKm - 1 / elements.semiMajorAxisKm));
  const apoapsisSpeedKmS = Math.sqrt(MU_EARTH_KM3_S2 * (2 / apoapsisRadiusKm - 1 / elements.semiMajorAxisKm));
  const initialEccentricAnomalyRad = eccentricAnomalyFromTrueAnomaly(elements.trueAnomalyRad, elements.eccentricity);
  const initialMeanAnomalyRad = wrapRadians(
    initialEccentricAnomalyRad - elements.eccentricity * Math.sin(initialEccentricAnomalyRad),
  );

  return {
    elements,
    meanMotionRadS,
    periodSeconds,
    periapsisRadiusKm,
    apoapsisRadiusKm,
    periapsisAltitudeKm: periapsisRadiusKm - EARTH_RADIUS_KM,
    apoapsisAltitudeKm: apoapsisRadiusKm - EARTH_RADIUS_KM,
    speedRangeKmS: {
      min: Math.min(periapsisSpeedKmS, apoapsisSpeedKmS),
      max: Math.max(periapsisSpeedKmS, apoapsisSpeedKmS),
    },
    initialMeanAnomalyRad,
  };
}

export function propagateOrbit(orbit, elapsedSeconds, options = {}) {
  const perturbationModel = normalizePerturbationModel(options.perturbationModel);
  const propagated = propagatedElementsAndMeanAnomaly(orbit, elapsedSeconds, perturbationModel);
  const state = stateAtMeanAnomaly(propagated.elements, propagated.meanAnomalyRad);

  return {
    ...state,
    elements: withAngularDegreeFields({
      ...propagated.elements,
      trueAnomalyRad: state.trueAnomalyRad,
    }),
    elapsedSeconds,
    perturbationModel,
  };
}

function vectorDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function interpolateVector(a, b, fraction) {
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    z: a.z + (b.z - a.z) * fraction,
  };
}

function interpolateNumber(a, b, fraction) {
  return Number.isFinite(a) && Number.isFinite(b)
    ? a + (b - a) * fraction
    : undefined;
}

function interpolateOrbitSample(previous, next, fraction) {
  const positionKm = interpolateVector(previous.positionKm, next.positionKm, fraction);
  const velocityKmS = previous.velocityKmS && next.velocityKmS
    ? interpolateVector(previous.velocityKmS, next.velocityKmS, fraction)
    : undefined;
  const radiusKm = interpolateNumber(previous.radiusKm, next.radiusKm, fraction);
  const elapsedSeconds = interpolateNumber(previous.elapsedSeconds, next.elapsedSeconds, fraction);

  return {
    ...next,
    positionKm,
    ...(velocityKmS ? { velocityKmS } : {}),
    ...(Number.isFinite(radiusKm) ? { radiusKm } : {}),
    ...(Number.isFinite(elapsedSeconds) ? { elapsedSeconds } : {}),
  };
}

function resampleByArcLength(samples, targetCount) {
  if (samples.length <= 1 || targetCount <= 1) return samples.slice(0, targetCount);

  const cumulativeLengths = [0];
  for (let index = 1; index < samples.length; index += 1) {
    cumulativeLengths[index] = cumulativeLengths[index - 1]
      + vectorDistance(samples[index - 1].positionKm, samples[index].positionKm);
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1];
  if (totalLength <= 0) return samples.slice(0, targetCount);

  const result = [];
  let segmentIndex = 1;
  for (let index = 0; index < targetCount; index += 1) {
    const targetLength = (index / targetCount) * totalLength;
    while (
      segmentIndex < cumulativeLengths.length - 1
      && cumulativeLengths[segmentIndex] < targetLength
    ) {
      segmentIndex += 1;
    }

    const previousLength = cumulativeLengths[segmentIndex - 1];
    const nextLength = cumulativeLengths[segmentIndex];
    const span = nextLength - previousLength;
    const fraction = span > 0 ? (targetLength - previousLength) / span : 0;
    result.push(interpolateOrbitSample(samples[segmentIndex - 1], samples[segmentIndex], fraction));
  }

  return result;
}

export function sampleOrbit(orbit, sampleCount = 360, options = {}) {
  const count = Math.max(12, Math.floor(sampleCount));
  const perturbationModel = normalizePerturbationModel(options.perturbationModel);
  const startElapsedSeconds = Number(options.startElapsedSeconds) || 0;
  const denseCount = Math.max(count * 12, 720);
  const denseSamples = Array.from({ length: denseCount + 1 }, (_, index) => {
    const elapsedSeconds = startElapsedSeconds + (index / denseCount) * orbit.periodSeconds;
    return propagateOrbit(orbit, elapsedSeconds, { perturbationModel });
  });
  return resampleByArcLength(denseSamples, count);
}

export function vectorMagnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '--';
  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const minutes = seconds / 60;
  const hours = seconds / 3600;
  return `${formatNumber(seconds, 2)} s (${formatNumber(minutes, 2)} min / ${formatNumber(hours, 2)} h)`;
}
