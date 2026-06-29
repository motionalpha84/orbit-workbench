import test from 'node:test';
import assert from 'node:assert/strict';

import { computeOrbit } from '../js/orbit.mjs';
import {
  ecefToLonLat,
  eciToEcef,
  greenwichSiderealAngleAt,
  groundTrackBudget,
  groundTrackCsv,
  groundTrackPoint,
  groundTrackRegionStats,
  normalizeLongitudeDeg,
  resolveGroundTrackWindow,
  sampleGroundTrack,
  splitDatelineSegments,
  utcMsFromInput,
} from '../js/groundtrack.mjs';

const nearlyEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
};

function circularEquatorialOrbit() {
  return computeOrbit({
    name: 'Ground Track Test',
    semiMajorAxisKm: 7000,
    eccentricity: 0,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });
}

test('normalizes longitudes into -180 to 180 degrees', () => {
  assert.equal(normalizeLongitudeDeg(181), -179);
  assert.equal(normalizeLongitudeDeg(-181), 179);
  assert.equal(normalizeLongitudeDeg(540), -180);
  assert.equal(normalizeLongitudeDeg(-540), -180);
});

test('parses UTC inputs without treating datetime-local strings as local time', () => {
  assert.equal(
    utcMsFromInput('2026-06-18T00:00'),
    Date.parse('2026-06-18T00:00:00.000Z'),
  );
  assert.equal(
    utcMsFromInput('2026-06-18T00:00:30Z'),
    Date.parse('2026-06-18T00:00:30.000Z'),
  );
});

test('computes Greenwich sidereal angle from UTC start and simulation seconds', () => {
  const j2000Noon = Date.parse('2000-01-01T12:00:00.000Z');
  const angle = greenwichSiderealAngleAt(j2000Noon, 0);

  nearlyEqual(angle, 4.894961212823756, 1e-9, 'J2000 Greenwich sidereal angle');
});

test('converts ECI coordinates to ECEF by Earth rotation angle', () => {
  const ecef = eciToEcef({ x: 1, y: 0, z: 0 }, Math.PI / 2);

  nearlyEqual(ecef.x, 0, 1e-12, 'rotated x');
  nearlyEqual(ecef.y, -1, 1e-12, 'rotated y');
  nearlyEqual(ecef.z, 0, 1e-12, 'rotated z');
});

test('converts ECEF vectors to geographic longitude and latitude', () => {
  const equatorEast = ecefToLonLat({ x: 0, y: 2, z: 0 });
  const northPole = ecefToLonLat({ x: 0, y: 0, z: 5 });

  nearlyEqual(equatorEast.longitudeDeg, 90, 1e-12, 'east longitude');
  nearlyEqual(equatorEast.latitudeDeg, 0, 1e-12, 'equator latitude');
  nearlyEqual(northPole.latitudeDeg, 90, 1e-12, 'north pole latitude');
});

test('computes a ground-track point from an orbit and UTC start', () => {
  const orbit = circularEquatorialOrbit();
  const point = groundTrackPoint(orbit, 0, {
    startUtcMs: Date.parse('2000-01-01T12:00:00.000Z'),
    perturbationModel: 'two-body',
  });

  nearlyEqual(point.latitudeDeg, 0, 1e-9, 'equatorial latitude');
  nearlyEqual(point.longitudeDeg, 79.53938163, 1e-6, 'longitude follows GMST');
  assert.equal(point.perturbationModel, 'two-body');
  assert.equal(point.elapsedSeconds, 0);
});

test('resolves time windows by revolutions or explicit seconds', () => {
  const orbit = circularEquatorialOrbit();

  assert.deepEqual(
    resolveGroundTrackWindow(orbit, { mode: 'revs', pastRevs: 2 }),
    { pastRevs: 2, pastSeconds: 0, futureSeconds: 0 },
  );
  assert.deepEqual(
    resolveGroundTrackWindow(orbit, { mode: 'time', pastSeconds: 60, futureSeconds: 120 }),
    { pastSeconds: 60, futureSeconds: 0 },
  );
});

test('samples current and retained past ground-track circles within a budget', () => {
  const orbit = circularEquatorialOrbit();
  const track = sampleGroundTrack({
    orbitRecord: { id: 'orbit-1', name: 'Orbit 1', color: '#568c87', orbit },
    centerElapsedSeconds: 12000,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'j2',
    window: { mode: 'revs', pastRevs: 2 },
    maxSamples: 360,
  });

  assert.equal(track.id, 'orbit-1');
  assert.equal(track.current.elapsedSeconds, 12000);
  assert.equal(track.pastSegments.length, 2);
  assert.equal(track.currentSegments.length, 1);
  assert.equal(Math.abs(track.currentEntryLongitudeDeg), 180);
  assert.ok(track.points.some((point) => point.phase === 'past'));
  assert.ok(track.points.some((point) => point.phase === 'current'));
  assert.equal(track.points.some((point) => point.phase === 'future'), false);
  assert.ok(track.points.every((point) => point.perturbationModel === 'j2'));
});

test('keeps the complete current ground-track circle when retained past circles is zero', () => {
  const orbit = circularEquatorialOrbit();
  const track = sampleGroundTrack({
    orbitRecord: { id: 'orbit-1', name: 'Orbit 1', color: '#568c87', orbit },
    centerElapsedSeconds: 1000,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'two-body',
    window: { mode: 'revs', pastRevs: 0 },
    maxSamples: 180,
  });
  const currentSegment = track.currentSegments[0];

  assert.equal(track.pastSegments.length, 0);
  assert.equal(track.window.boundaryCount, 1);
  assert.equal(Math.abs(currentSegment[0].longitudeDeg), 180);
  assert.ok(currentSegment[0].elapsedSeconds < track.current.elapsedSeconds);
  assert.ok(track.points.every((point) => point.elapsedSeconds >= currentSegment[0].elapsedSeconds));
});

test('keeps enough samples per retained ground-track circle when many circles are shown', () => {
  const orbit = circularEquatorialOrbit();
  const track = sampleGroundTrack({
    orbitRecord: { id: 'orbit-1', name: 'Orbit 1', color: '#568c87', orbit },
    centerElapsedSeconds: 50000,
    startUtcMs: Date.parse('2026-06-18T00:00:00.000Z'),
    perturbationModel: 'two-body',
    window: { mode: 'revs', pastRevs: 8 },
    maxSamples: 900,
  });
  const allSegments = [...track.pastSegments, ...track.currentSegments];

  assert.equal(track.pastSegments.length, 8);
  assert.equal(track.currentSegments.length, 1);
  assert.ok(allSegments.every((segment) => segment.length >= 90));
  assert.ok(allSegments.every((segment) => Math.abs(segment[0].longitudeDeg) === 180));
});

test('splits map segments when a path crosses the dateline', () => {
  const segments = splitDatelineSegments([
    { longitudeDeg: 170, latitudeDeg: 0 },
    { longitudeDeg: 179, latitudeDeg: 1 },
    { longitudeDeg: -178, latitudeDeg: 2 },
    { longitudeDeg: -160, latitudeDeg: 3 },
  ]);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[1].length, 2);
});

test('exports ground-track data as CSV', () => {
  const csv = groundTrackCsv([
    {
      id: 'orbit-1',
      name: 'Orbit 1',
      color: '#568c87',
      points: [
        {
          elapsedSeconds: 12.5,
          utcMs: Date.parse('2026-06-18T00:00:12.500Z'),
          longitudeDeg: 120.123456,
          latitudeDeg: -12.5,
          perturbationModel: 'j3',
        },
      ],
    },
  ]);

  assert.match(csv, /轨道名称,轨道 ID,仿真秒,UTC 时间,经度,纬度,动力学模型/);
  assert.match(csv, /Orbit 1,orbit-1,12\.500,2026-06-18T00:00:12\.500Z,120\.123456,-12\.500000,j3/);
});

test('summarizes selected region hits by orbit', () => {
  const stats = groundTrackRegionStats([
    {
      id: 'a',
      name: 'A',
      color: '#568c87',
      points: [
        { elapsedSeconds: 10, longitudeDeg: 10, latitudeDeg: 20, utcMs: 1000, perturbationModel: 'j2' },
        { elapsedSeconds: 20, longitudeDeg: 40, latitudeDeg: 80, utcMs: 2000, perturbationModel: 'j2' },
      ],
    },
  ], {
    westDeg: 0,
    eastDeg: 30,
    southDeg: 10,
    northDeg: 30,
  });

  assert.equal(stats.totalOrbitCount, 1);
  assert.equal(stats.totalPointCount, 1);
  assert.equal(stats.items[0].name, 'A');
  assert.equal(stats.items[0].pointCount, 1);
  assert.equal(stats.items[0].earliestUtcMs, 1000);
});

test('returns performance budgets for presets and custom memory', () => {
  assert.ok(groundTrackBudget({ mode: 'high' }).maxGroundTrackSamples >= 2400);
  assert.ok(groundTrackBudget({ mode: 'power-save' }).maxGroundTrackSamples < groundTrackBudget({ mode: 'balanced' }).maxGroundTrackSamples);
  assert.ok(groundTrackBudget({ mode: 'custom', memoryGb: 2 }).maxGroundTrackSamples < groundTrackBudget({ mode: 'custom', memoryGb: 8 }).maxGroundTrackSamples);
  assert.ok(groundTrackBudget({ mode: 'high' }).groundTrackSamplesPerRev > groundTrackBudget({ mode: 'power-save' }).groundTrackSamplesPerRev);
});
