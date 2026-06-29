import { propagateOrbit } from './orbit.mjs';

const MS_PER_DAY = 86400000;
const UNIX_EPOCH_JULIAN_DATE = 2440587.5;
const J2000_JULIAN_DATE = 2451545.0;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeLongitudeDeg(longitudeDeg) {
  const wrapped = ((finiteNumber(longitudeDeg) + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function utcMsFromInput(value, fallbackMs = Date.now()) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return fallbackMs;

  const trimmed = value.trim();
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const utcText = hasTimezone
    ? trimmed
    : `${trimmed.length === 16 ? `${trimmed}:00` : trimmed}Z`;
  const parsed = Date.parse(utcText);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function julianDateFromUtcMs(utcMs) {
  return utcMs / MS_PER_DAY + UNIX_EPOCH_JULIAN_DATE;
}

export function greenwichSiderealAngleAt(startUtcMs, elapsedSeconds = 0) {
  const utcMs = utcMsFromInput(startUtcMs) + finiteNumber(elapsedSeconds) * 1000;
  const julianDate = julianDateFromUtcMs(utcMs);
  const centuries = (julianDate - J2000_JULIAN_DATE) / 36525;
  const gmstDeg = 280.46061837
    + 360.98564736629 * (julianDate - J2000_JULIAN_DATE)
    + 0.000387933 * centuries * centuries
    - (centuries * centuries * centuries) / 38710000;
  return ((gmstDeg % 360 + 360) % 360) * DEG_TO_RAD;
}

export function eciToEcef(positionEci, siderealAngleRad) {
  const cosTheta = Math.cos(siderealAngleRad);
  const sinTheta = Math.sin(siderealAngleRad);
  return {
    x: cosTheta * positionEci.x + sinTheta * positionEci.y,
    y: -sinTheta * positionEci.x + cosTheta * positionEci.y,
    z: positionEci.z,
  };
}

export function ecefToLonLat(positionEcef) {
  const horizontal = Math.hypot(positionEcef.x, positionEcef.y);
  const radius = Math.hypot(horizontal, positionEcef.z);
  if (radius === 0) {
    return { longitudeDeg: 0, latitudeDeg: 0 };
  }
  return {
    longitudeDeg: normalizeLongitudeDeg(Math.atan2(positionEcef.y, positionEcef.x) * RAD_TO_DEG),
    latitudeDeg: Math.asin(Math.max(-1, Math.min(1, positionEcef.z / radius))) * RAD_TO_DEG,
  };
}

export function groundTrackPoint(orbit, elapsedSeconds, options = {}) {
  const startUtcMs = utcMsFromInput(options.startUtcMs ?? options.startUtc);
  const perturbationModel = options.perturbationModel ?? 'two-body';
  const state = propagateOrbit(orbit, elapsedSeconds, { perturbationModel });
  const siderealAngleRad = greenwichSiderealAngleAt(startUtcMs, elapsedSeconds);
  const positionEcefKm = eciToEcef(state.positionKm, siderealAngleRad);
  const lonLat = ecefToLonLat(positionEcefKm);
  return {
    ...lonLat,
    elapsedSeconds,
    utcMs: startUtcMs + elapsedSeconds * 1000,
    positionEciKm: state.positionKm,
    positionEcefKm,
    perturbationModel: state.perturbationModel,
  };
}

export function resolveGroundTrackWindow(orbit, window = {}) {
  if (window.mode === 'time') {
    return {
      pastSeconds: Math.max(0, finiteNumber(window.pastSeconds, 3600)),
      futureSeconds: 0,
    };
  }
  const pastRevs = Math.max(0, Math.floor(finiteNumber(window.pastRevs, 2)));
  return {
    pastRevs,
    pastSeconds: 0,
    futureSeconds: 0,
  };
}

export function sampleGroundTrack({
  orbitRecord,
  centerElapsedSeconds = 0,
  startUtcMs,
  perturbationModel = 'two-body',
  window = { mode: 'revs', pastRevs: 2 },
  maxSamples = 720,
} = {}) {
  let resolvedWindow = resolveGroundTrackWindow(orbitRecord.orbit, window);
  const sampleCount = Math.max(2, Math.floor(finiteNumber(maxSamples, 720)));
  const current = groundTrackPoint(orbitRecord.orbit, centerElapsedSeconds, {
    startUtcMs,
    perturbationModel,
  });
  let slicedSegments = { pastSegments: [], currentSegments: [[current]], segments: [[current]], points: [current] };

  if (window.mode === 'time') {
    const points = samplePastGroundTrackPoints({
      orbit: orbitRecord.orbit,
      centerElapsedSeconds,
      startUtcMs,
      perturbationModel,
      pastSeconds: resolvedWindow.pastSeconds,
      sampleCount,
    });
    slicedSegments = sliceGroundTrackSegments(points, {
      mode: 'time',
    });
  } else {
    const sampled = sampleGroundTrackRevolutions({
      orbit: orbitRecord.orbit,
      centerElapsedSeconds,
      startUtcMs,
      perturbationModel,
      pastRevs: resolvedWindow.pastRevs,
      sampleCount,
      current,
    });
    slicedSegments = sampled.slicedSegments;
    resolvedWindow = {
      ...resolvedWindow,
      pastSeconds: sampled.pastSeconds,
      boundaryCount: sampled.boundaryCount,
    };
  }

  return {
    id: orbitRecord.id,
    name: orbitRecord.name,
    color: orbitRecord.color,
    orbit: orbitRecord.orbit,
    window: resolvedWindow,
    current,
    points: slicedSegments.points,
    segments: slicedSegments.segments,
    pastSegments: slicedSegments.pastSegments,
    currentSegments: slicedSegments.currentSegments,
    currentEntryLongitudeDeg: slicedSegments.currentEntryLongitudeDeg,
  };
}

export function datelineBoundaryBetween(previous, point) {
  if (Math.abs(point.longitudeDeg - previous.longitudeDeg) <= 180) return null;
  const eastward = previous.longitudeDeg > 0 && point.longitudeDeg < 0;
  const exitLongitudeDeg = eastward ? 180 : -180;
  const entryLongitudeDeg = eastward ? -180 : 180;
  const adjustedLongitudeDeg = eastward ? point.longitudeDeg + 360 : point.longitudeDeg - 360;
  const fraction = (exitLongitudeDeg - previous.longitudeDeg) / (adjustedLongitudeDeg - previous.longitudeDeg);
  const exitPoint = interpolateGroundTrackPoint(previous, point, fraction, exitLongitudeDeg, 'past');
  const entryPoint = interpolateGroundTrackPoint(previous, point, fraction, entryLongitudeDeg, point.phase);
  return {
    elapsedSeconds: entryPoint.elapsedSeconds,
    exitPoint,
    entryPoint,
  };
}

function findPreviousDatelineBoundaries({
  orbit,
  centerElapsedSeconds,
  startUtcMs,
  perturbationModel,
  requiredBoundaryCount,
  current,
}) {
  const safeRequiredCount = Math.max(1, Math.floor(finiteNumber(requiredBoundaryCount, 1)));
  const stepSeconds = Math.max(10, orbit.periodSeconds / 240);
  const maxSteps = Math.max(1440, safeRequiredCount * 720);
  const boundaries = [];
  let newer = { ...current, phase: 'current' };

  for (let step = 1; step <= maxSteps && boundaries.length < safeRequiredCount; step += 1) {
    const olderElapsedSeconds = centerElapsedSeconds - step * stepSeconds;
    const older = {
      ...groundTrackPoint(orbit, olderElapsedSeconds, { startUtcMs, perturbationModel }),
      phase: 'past',
    };
    const boundary = datelineBoundaryBetween(older, newer);
    if (boundary) boundaries.push(boundary);
    newer = older;
  }

  return boundaries;
}

function sampleGroundTrackSegmentPoints({
  orbit,
  startPoint,
  endPoint,
  startUtcMs,
  perturbationModel,
  sampleCount,
  phase,
}) {
  const count = Math.max(2, Math.floor(finiteNumber(sampleCount, 2)));
  const startElapsedSeconds = finiteNumber(startPoint.elapsedSeconds);
  const endElapsedSeconds = finiteNumber(endPoint.elapsedSeconds);
  const spanSeconds = endElapsedSeconds - startElapsedSeconds;
  if (spanSeconds <= 0) return [{ ...startPoint, phase }, { ...endPoint, phase }];

  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { ...startPoint, phase };
    if (index === count - 1) return { ...endPoint, phase };
    const fraction = index / (count - 1);
    const elapsedSeconds = startElapsedSeconds + spanSeconds * fraction;
    return {
      ...groundTrackPoint(orbit, elapsedSeconds, { startUtcMs, perturbationModel }),
      phase,
    };
  });
}

function sampleGroundTrackRevolutions({
  orbit,
  centerElapsedSeconds,
  startUtcMs,
  perturbationModel,
  pastRevs,
  sampleCount,
  current,
}) {
  const requestedPastRevs = Math.max(0, Math.floor(finiteNumber(pastRevs, 0)));
  const requiredBoundaryCount = requestedPastRevs + 1;
  const boundariesNewestFirst = findPreviousDatelineBoundaries({
    orbit,
    centerElapsedSeconds,
    startUtcMs,
    perturbationModel,
    requiredBoundaryCount,
    current,
  });
  const retainedBoundaries = boundariesNewestFirst
    .slice(0, requiredBoundaryCount)
    .reverse();
  const oldestBoundary = retainedBoundaries[0];
  const pastSeconds = oldestBoundary
    ? Math.max(0, centerElapsedSeconds - oldestBoundary.entryPoint.elapsedSeconds)
    : 0;
  const samplesPerSegment = Math.max(
    24,
    Math.floor(finiteNumber(sampleCount, 720) / Math.max(1, retainedBoundaries.length)),
  );
  const retainedSegments = retainedBoundaries.map((boundary, index) => {
    const isCurrentSegment = index === retainedBoundaries.length - 1;
    const nextBoundary = retainedBoundaries[index + 1];
    const endPoint = isCurrentSegment ? current : nextBoundary.exitPoint;
    return sampleGroundTrackSegmentPoints({
      orbit,
      startPoint: boundary.entryPoint,
      endPoint,
      startUtcMs,
      perturbationModel,
      sampleCount: samplesPerSegment,
      phase: isCurrentSegment ? 'current' : 'past',
    });
  });
  const pastSegments = retainedSegments.slice(0, -1);
  const currentSegments = retainedSegments.length
    ? [retainedSegments[retainedSegments.length - 1]]
    : [[current]];
  const segments = [...pastSegments, ...currentSegments];
  const points = segments.flat();

  return {
    pastSeconds,
    boundaryCount: retainedBoundaries.length,
    slicedSegments: {
      pastSegments,
      currentSegments,
      segments,
      points: points.length ? points : [current],
      currentEntryLongitudeDeg: currentSegments[0]?.[0]?.longitudeDeg ?? null,
    },
  };
}

function samplePastGroundTrackPoints({
  orbit,
  centerElapsedSeconds,
  startUtcMs,
  perturbationModel,
  pastSeconds,
  sampleCount,
}) {
  const safePastSeconds = Math.max(0, finiteNumber(pastSeconds, 0));
  const startElapsedSeconds = centerElapsedSeconds - safePastSeconds;
  return Array.from({ length: sampleCount }, (_, index) => {
    const fraction = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const elapsedSeconds = startElapsedSeconds + safePastSeconds * fraction;
    const point = groundTrackPoint(orbit, elapsedSeconds, {
      startUtcMs,
      perturbationModel,
    });
    return {
      ...point,
      phase: elapsedSeconds < centerElapsedSeconds ? 'past' : 'current',
    };
  });
}

function interpolateGroundTrackPoint(previous, point, fraction, longitudeDeg, phase = point.phase) {
  const blend = Math.max(0, Math.min(1, finiteNumber(fraction, 0)));
  const interpolate = (a, b) => finiteNumber(a) + (finiteNumber(b) - finiteNumber(a)) * blend;
  const elapsedSeconds = interpolate(previous.elapsedSeconds, point.elapsedSeconds);
  const utcMs = interpolate(previous.utcMs, point.utcMs);
  return {
    ...point,
    longitudeDeg,
    latitudeDeg: interpolate(previous.latitudeDeg, point.latitudeDeg),
    elapsedSeconds,
    utcMs,
    phase,
    boundary: true,
  };
}

function splitDatelineSegmentsWithEntries(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const segments = [];
  let current = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const boundary = datelineBoundaryBetween(previous, point);
    if (boundary) {
      const { exitPoint, entryPoint } = boundary;
      current.push(exitPoint);
      if (current.length > 1) segments.push(current);
      current = [entryPoint, point];
      continue;
    }
    current.push(point);
  }

  if (current.length > 0) segments.push(current);
  return segments;
}

function sliceGroundTrackSegments(points, { mode = 'revs', pastRevs = 0 } = {}) {
  const allSegments = splitDatelineSegmentsWithEntries(points);
  const currentSegments = allSegments.length > 0 ? [allSegments[allSegments.length - 1]] : [];
  const requestedPastRevs = Math.max(0, Math.floor(finiteNumber(pastRevs, 0)));
  const availablePastSegments = allSegments.slice(0, -1);
  const pastSegments = mode === 'time'
    ? availablePastSegments
    : availablePastSegments.slice(Math.max(0, availablePastSegments.length - requestedPastRevs));
  const segments = [...pastSegments, ...currentSegments];
  const flattenedPoints = segments.flat();

  return {
    pastSegments,
    currentSegments,
    segments,
    points: flattenedPoints.length > 0 ? flattenedPoints : points,
    currentEntryLongitudeDeg: currentSegments[0]?.[0]?.longitudeDeg ?? null,
  };
}

export function splitDatelineSegments(points, thresholdDeg = 180) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      if (Math.abs(point.longitudeDeg - previous.longitudeDeg) > thresholdDeg) {
        segments.push(current);
        current = [];
      }
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function groundTrackCsv(tracks) {
  const rows = [['轨道名称', '轨道 ID', '仿真秒', 'UTC 时间', '经度', '纬度', '动力学模型']];
  for (const track of tracks) {
    for (const point of track.points ?? []) {
      rows.push([
        track.name,
        track.id,
        finiteNumber(point.elapsedSeconds).toFixed(3),
        new Date(point.utcMs).toISOString(),
        finiteNumber(point.longitudeDeg).toFixed(6),
        finiteNumber(point.latitudeDeg).toFixed(6),
        point.perturbationModel,
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function longitudeInBounds(longitudeDeg, bounds) {
  if (bounds.westDeg <= bounds.eastDeg) {
    return longitudeDeg >= bounds.westDeg && longitudeDeg <= bounds.eastDeg;
  }
  return longitudeDeg >= bounds.westDeg || longitudeDeg <= bounds.eastDeg;
}

export function groundTrackRegionStats(tracks, bounds) {
  const items = [];
  for (const track of tracks) {
    const hits = (track.points ?? []).filter((point) => (
      longitudeInBounds(point.longitudeDeg, bounds)
      && point.latitudeDeg >= bounds.southDeg
      && point.latitudeDeg <= bounds.northDeg
    ));
    if (hits.length === 0) continue;

    items.push({
      id: track.id,
      name: track.name,
      color: track.color,
      pointCount: hits.length,
      earliestUtcMs: Math.min(...hits.map((point) => point.utcMs)),
      latestUtcMs: Math.max(...hits.map((point) => point.utcMs)),
      minElapsedSeconds: Math.min(...hits.map((point) => point.elapsedSeconds)),
      maxElapsedSeconds: Math.max(...hits.map((point) => point.elapsedSeconds)),
      westDeg: Math.min(...hits.map((point) => point.longitudeDeg)),
      eastDeg: Math.max(...hits.map((point) => point.longitudeDeg)),
      southDeg: Math.min(...hits.map((point) => point.latitudeDeg)),
      northDeg: Math.max(...hits.map((point) => point.latitudeDeg)),
      perturbationModel: hits[0].perturbationModel,
    });
  }

  return {
    bounds,
    items,
    totalOrbitCount: items.length,
    totalPointCount: items.reduce((sum, item) => sum + item.pointCount, 0),
    earliestUtcMs: items.length ? Math.min(...items.map((item) => item.earliestUtcMs)) : null,
    latestUtcMs: items.length ? Math.max(...items.map((item) => item.latestUtcMs)) : null,
  };
}

export function groundTrackBudget({ mode = 'balanced', memoryGb = 4 } = {}) {
  if (mode === 'power-save') {
    return {
      max3dReferenceSamples: 900,
      maxGroundTrackSamples: 2400,
      groundTrackSamplesPerRev: 96,
      mapCacheTracks: 12,
    };
  }
  if (mode === 'high') {
    return {
      max3dReferenceSamples: 3600,
      maxGroundTrackSamples: 12000,
      groundTrackSamplesPerRev: 240,
      mapCacheTracks: 48,
    };
  }
  if (mode === 'custom') {
    const gb = Math.max(1, Math.min(24, finiteNumber(memoryGb, 4)));
    const scale = Math.sqrt(gb / 4);
    return {
      max3dReferenceSamples: Math.round(1600 * scale),
      maxGroundTrackSamples: Math.round(5000 * scale),
      groundTrackSamplesPerRev: Math.round(150 * scale),
      mapCacheTracks: Math.round(18 * scale),
    };
  }
  return {
    max3dReferenceSamples: 1800,
    maxGroundTrackSamples: 6000,
    groundTrackSamplesPerRev: 160,
    mapCacheTracks: 24,
  };
}
