import test from 'node:test';
import assert from 'node:assert/strict';

import { computeOrbit } from '../js/orbit.mjs';
import {
  createGroundTrackHistory,
  groundTrackTrackFromHistory,
  pruneGroundTrackHistory,
  updateGroundTrackHistory,
} from '../js/groundtrack-history.mjs';

function circularEquatorialOrbit() {
  return computeOrbit({
    name: 'Cached Ground Track',
    semiMajorAxisKm: 7000,
    eccentricity: 0,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });
}

function orbitRecord() {
  return {
    id: 'orbit-cache-1',
    name: 'Orbit Cache 1',
    color: '#568c87',
    orbit: circularEquatorialOrbit(),
  };
}

function eccentricOrbitRecord() {
  return {
    id: 'orbit-cache-eccentric',
    name: 'Eccentric Cache',
    color: '#568c87',
    orbit: computeOrbit({
      name: 'Eccentric Cache',
      semiMajorAxisKm: 18000,
      eccentricity: 0.45,
      inclinationDeg: 28.5,
      raanDeg: 40,
      argPeriapsisDeg: 15,
      trueAnomalyDeg: 0,
    }),
  };
}

test('starts cached ground tracks at the current simulation time without backfilling', () => {
  const record = orbitRecord();
  const history = createGroundTrackHistory({
    orbitRecord: record,
    elapsedSeconds: 1200,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'two-body',
  });
  const track = groundTrackTrackFromHistory(history, record, { mode: 'revs', pastRevs: 2 });

  assert.equal(history.initializedElapsedSeconds, 1200);
  assert.equal(track.pastSegments.length, 0);
  assert.equal(track.currentSegments.length, 1);
  assert.deepEqual(track.points.map((point) => point.elapsedSeconds), [1200]);
});

test('retains only requested completed cached circles and cannot restore pruned circles', () => {
  const record = orbitRecord();
  const startUtcMs = Date.parse('2026-06-18T00:00:00.000Z');
  let history = createGroundTrackHistory({
    orbitRecord: record,
    elapsedSeconds: 0,
    startUtcMs,
    perturbationModel: 'two-body',
  });

  history = updateGroundTrackHistory(history, {
    orbitRecord: record,
    elapsedSeconds: 50000,
    startUtcMs,
    perturbationModel: 'two-body',
    maxCatchUpPoints: 2400,
    window: { mode: 'revs', pastRevs: 2 },
  });

  assert.equal(history.pastSegments.length, 2);
  const earliestAfterTwoRevs = Math.min(...history.pastSegments.flat().map((point) => point.elapsedSeconds));

  pruneGroundTrackHistory(history, { mode: 'revs', pastRevs: 0 }, 50000);
  assert.equal(history.pastSegments.length, 0);

  pruneGroundTrackHistory(history, { mode: 'revs', pastRevs: 4 }, 50000);
  assert.equal(history.pastSegments.length, 0);

  history = updateGroundTrackHistory(history, {
    orbitRecord: record,
    elapsedSeconds: 62000,
    startUtcMs,
    perturbationModel: 'two-body',
    maxCatchUpPoints: 2400,
    window: { mode: 'revs', pastRevs: 4 },
  });

  const track = groundTrackTrackFromHistory(history, record, { mode: 'revs', pastRevs: 4 });
  assert.ok(track.points.every((point) => point.elapsedSeconds >= earliestAfterTwoRevs));
});

test('uses the arc-length reference sample schedule instead of fixed time spacing', () => {
  const record = eccentricOrbitRecord();
  const history = createGroundTrackHistory({
    orbitRecord: record,
    elapsedSeconds: 0,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'two-body',
    referenceSampleCount: 120,
  });
  const gaps = history.referenceSampleOffsets
    .slice(1)
    .map((offset, index) => offset - history.referenceSampleOffsets[index]);
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);

  assert.equal(history.referenceSampleOffsets.length, 120);
  assert.ok(maxGap / minGap > 1.2);
});
