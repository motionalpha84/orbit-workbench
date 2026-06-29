import {
  datelineBoundaryBetween,
  groundTrackPoint,
} from './groundtrack.mjs';
import { sampleOrbit } from './orbit.mjs';

const EPSILON_SECONDS = 1e-6;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointWithPhase(point, phase) {
  return { ...point, phase };
}

function sameElapsedSecond(a, b) {
  return Boolean(a && b) && Math.abs(a.elapsedSeconds - b.elapsedSeconds) <= EPSILON_SECONDS;
}

function normalizePeriodOffset(elapsedSeconds, periodSeconds) {
  const period = Math.max(EPSILON_SECONDS, finiteNumber(periodSeconds, 1));
  const wrapped = finiteNumber(elapsedSeconds) % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

function appendUniquePoint(segment, point) {
  const last = segment[segment.length - 1];
  if (sameElapsedSecond(last, point)) {
    segment[segment.length - 1] = point;
    return;
  }
  segment.push(point);
}

function orbitSignature(orbitRecord) {
  const elements = orbitRecord.orbit.elements;
  return [
    elements.semiMajorAxisKm,
    elements.eccentricity,
    elements.inclinationDeg,
    elements.raanDeg,
    elements.argPeriapsisDeg,
    elements.trueAnomalyDeg,
  ].map((value) => finiteNumber(value).toPrecision(15)).join('|');
}

export function groundTrackHistorySignature(orbitRecord, {
  startUtcMs,
  perturbationModel = 'two-body',
  referenceSampleCount = 180,
} = {}) {
  return [
    orbitRecord.id,
    finiteNumber(startUtcMs),
    perturbationModel,
    Math.max(12, Math.floor(finiteNumber(referenceSampleCount, 180))),
    orbitSignature(orbitRecord),
  ].join('::');
}

function isCompatibleHistory(history, orbitRecord, options) {
  return history?.signature === groundTrackHistorySignature(orbitRecord, options);
}

function buildReferenceSampleOffsets(orbit, {
  perturbationModel = 'two-body',
  referenceSampleCount = 180,
} = {}) {
  const count = Math.max(12, Math.floor(finiteNumber(referenceSampleCount, 180)));
  const periodSeconds = Math.max(EPSILON_SECONDS, finiteNumber(orbit.periodSeconds, 1));
  const samples = sampleOrbit(orbit, count, {
    perturbationModel,
    startElapsedSeconds: 0,
  });
  const offsets = samples
    .map((sample) => normalizePeriodOffset(sample.elapsedSeconds, periodSeconds))
    .filter((offset) => Number.isFinite(offset))
    .sort((a, b) => a - b);
  const uniqueOffsets = [];
  for (const offset of offsets) {
    const previous = uniqueOffsets[uniqueOffsets.length - 1];
    if (previous === undefined || Math.abs(offset - previous) > EPSILON_SECONDS) {
      uniqueOffsets.push(offset);
    }
  }
  return uniqueOffsets.length > 0 ? uniqueOffsets : [0];
}

function firstReferencePointerAfter(elapsedSeconds, offsets, periodSeconds) {
  const period = Math.max(EPSILON_SECONDS, finiteNumber(periodSeconds, 1));
  const safeElapsedSeconds = Math.max(0, finiteNumber(elapsedSeconds));
  let revolution = Math.floor(safeElapsedSeconds / period);
  const withinPeriod = safeElapsedSeconds - revolution * period;
  const index = offsets.findIndex((offset) => offset > withinPeriod + EPSILON_SECONDS);
  if (index >= 0) return { revolution, index };
  return { revolution: revolution + 1, index: 0 };
}

function referenceElapsedSeconds(history) {
  const offsets = history.referenceSampleOffsets;
  if (!offsets?.length) return Infinity;
  const index = Math.min(Math.max(0, history.nextReferenceIndex), offsets.length - 1);
  return history.nextReferenceRevolution * history.periodSeconds + offsets[index];
}

function advanceReferencePointer(history) {
  history.nextReferenceIndex += 1;
  if (history.nextReferenceIndex >= history.referenceSampleOffsets.length) {
    history.nextReferenceIndex = 0;
    history.nextReferenceRevolution += 1;
  }
}

export function createGroundTrackHistory({
  orbitRecord,
  elapsedSeconds = 0,
  startUtcMs,
  perturbationModel = 'two-body',
  referenceSampleCount = 180,
} = {}) {
  const safeElapsedSeconds = Math.max(0, finiteNumber(elapsedSeconds));
  const periodSeconds = Math.max(EPSILON_SECONDS, finiteNumber(orbitRecord.orbit.periodSeconds, 1));
  const referenceSampleOffsets = buildReferenceSampleOffsets(orbitRecord.orbit, {
    perturbationModel,
    referenceSampleCount,
  });
  const pointer = firstReferencePointerAfter(safeElapsedSeconds, referenceSampleOffsets, periodSeconds);
  const current = pointWithPhase(groundTrackPoint(orbitRecord.orbit, safeElapsedSeconds, {
    startUtcMs,
    perturbationModel,
  }), 'current');

  return {
    id: orbitRecord.id,
    signature: groundTrackHistorySignature(orbitRecord, { startUtcMs, perturbationModel, referenceSampleCount }),
    initializedElapsedSeconds: safeElapsedSeconds,
    lastSampleElapsedSeconds: safeElapsedSeconds,
    lastObservedPoint: current,
    current,
    periodSeconds,
    referenceSampleCount,
    referenceSampleOffsets,
    nextReferenceRevolution: pointer.revolution,
    nextReferenceIndex: pointer.index,
    pastSegments: [],
    currentSegment: [current],
  };
}

function completeCurrentSegment(history, boundary) {
  const exitPoint = pointWithPhase(boundary.exitPoint, 'past');
  const entryPoint = pointWithPhase(boundary.entryPoint, 'current');
  appendUniquePoint(history.currentSegment, exitPoint);
  if (history.currentSegment.length > 1) {
    history.pastSegments.push(history.currentSegment.map((point) => pointWithPhase(point, 'past')));
  }
  history.currentSegment = [entryPoint];
  history.lastSampleElapsedSeconds = entryPoint.elapsedSeconds;
}

function observeGroundTrackPoint(history, point, { commit = false } = {}) {
  const currentPoint = pointWithPhase(point, 'current');
  const previous = history.lastObservedPoint;
  if (!previous || currentPoint.elapsedSeconds < previous.elapsedSeconds - EPSILON_SECONDS) {
    history.lastObservedPoint = currentPoint;
    history.current = currentPoint;
    history.currentSegment = [currentPoint];
    history.lastSampleElapsedSeconds = currentPoint.elapsedSeconds;
    return;
  }
  if (sameElapsedSecond(previous, currentPoint)) {
    history.lastObservedPoint = currentPoint;
    history.current = currentPoint;
    return;
  }

  const boundary = datelineBoundaryBetween(previous, currentPoint);
  const shouldCommit = commit || Boolean(boundary);
  if (boundary) completeCurrentSegment(history, boundary);
  if (shouldCommit) {
    appendUniquePoint(history.currentSegment, currentPoint);
    history.lastSampleElapsedSeconds = currentPoint.elapsedSeconds;
  }

  history.lastObservedPoint = currentPoint;
  history.current = currentPoint;
}

export function pruneGroundTrackHistory(history, window = {}, currentElapsedSeconds = history.current?.elapsedSeconds ?? 0) {
  if (!history) return history;

  if (window.mode === 'time') {
    const cutoff = Math.max(0, finiteNumber(currentElapsedSeconds) - Math.max(0, finiteNumber(window.pastSeconds, 0)));
    history.pastSegments = history.pastSegments
      .map((segment) => segment.filter((point) => point.elapsedSeconds >= cutoff))
      .filter((segment) => segment.length > 0);
    history.currentSegment = history.currentSegment.filter((point) => point.elapsedSeconds >= cutoff);
    if (history.currentSegment.length === 0 && history.current) {
      history.currentSegment = [pointWithPhase(history.current, 'current')];
    }
    return history;
  }

  const pastRevs = Math.max(0, Math.floor(finiteNumber(window.pastRevs, 2)));
  const overflow = history.pastSegments.length - pastRevs;
  if (overflow > 0) history.pastSegments.splice(0, overflow);
  return history;
}

export function updateGroundTrackHistory(history, {
  orbitRecord,
  elapsedSeconds = 0,
  startUtcMs,
  perturbationModel = 'two-body',
  referenceSampleCount = 180,
  window = { mode: 'revs', pastRevs: 2 },
  maxCatchUpPoints = 600,
} = {}) {
  const safeElapsedSeconds = Math.max(0, finiteNumber(elapsedSeconds));
  const signatureOptions = { startUtcMs, perturbationModel, referenceSampleCount };
  let nextHistory = history;

  if (
    !isCompatibleHistory(nextHistory, orbitRecord, signatureOptions)
    || safeElapsedSeconds < (nextHistory.lastObservedPoint?.elapsedSeconds ?? 0) - EPSILON_SECONDS
  ) {
    nextHistory = createGroundTrackHistory({
      orbitRecord,
      elapsedSeconds: safeElapsedSeconds,
      startUtcMs,
      perturbationModel,
      referenceSampleCount,
    });
    pruneGroundTrackHistory(nextHistory, window, safeElapsedSeconds);
    return nextHistory;
  }

  let catchUpCount = 0;
  while (
    referenceElapsedSeconds(nextHistory) <= safeElapsedSeconds + EPSILON_SECONDS
    && catchUpCount < maxCatchUpPoints
  ) {
    const nextSampleElapsedSeconds = referenceElapsedSeconds(nextHistory);
    observeGroundTrackPoint(nextHistory, groundTrackPoint(orbitRecord.orbit, nextSampleElapsedSeconds, {
      startUtcMs,
      perturbationModel,
    }), { commit: true });
    advanceReferencePointer(nextHistory);
    catchUpCount += 1;
  }
  if (referenceElapsedSeconds(nextHistory) <= safeElapsedSeconds + EPSILON_SECONDS) {
    const pointer = firstReferencePointerAfter(
      safeElapsedSeconds,
      nextHistory.referenceSampleOffsets,
      nextHistory.periodSeconds,
    );
    nextHistory.nextReferenceRevolution = pointer.revolution;
    nextHistory.nextReferenceIndex = pointer.index;
  }

  const currentPoint = groundTrackPoint(orbitRecord.orbit, safeElapsedSeconds, {
    startUtcMs,
    perturbationModel,
  });
  observeGroundTrackPoint(nextHistory, currentPoint, { commit: false });
  pruneGroundTrackHistory(nextHistory, window, safeElapsedSeconds);
  return nextHistory;
}

export function groundTrackTrackFromHistory(history, orbitRecord, window = {}) {
  const currentSegment = history.currentSegment.map((point) => pointWithPhase(point, 'current'));
  if (history.current) {
    const last = currentSegment[currentSegment.length - 1];
    if (!sameElapsedSecond(last, history.current)) {
      currentSegment.push(pointWithPhase(history.current, 'current'));
    }
  }

  const pastSegments = history.pastSegments.map((segment) => segment.map((point) => pointWithPhase(point, 'past')));
  const currentSegments = currentSegment.length > 0 ? [currentSegment] : [];
  const segments = [...pastSegments, ...currentSegments];
  const points = segments.flat();

  return {
    id: orbitRecord.id,
    name: orbitRecord.name,
    color: orbitRecord.color,
    orbit: orbitRecord.orbit,
    window: {
      ...window,
      boundaryCount: pastSegments.length + currentSegments.length,
    },
    current: history.current,
    points,
    segments,
    pastSegments,
    currentSegments,
    currentEntryLongitudeDeg: currentSegments[0]?.[0]?.longitudeDeg ?? null,
  };
}
