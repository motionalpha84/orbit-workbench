import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EARTH_RADIUS_KM,
  MU_EARTH_KM3_S2,
  computeOrbit,
  formatElementLabel,
  formatDuration,
  normalizePerturbationModel,
  normalizeElements,
  propagateOrbit,
  sampleOrbit,
  validateElements,
  vectorMagnitude,
} from '../js/orbit.mjs';

const nearlyEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
};

test('formats classic element labels with degree symbol and Ω', () => {
  assert.equal(formatElementLabel('raan'), 'Ω / °');
  assert.equal(formatElementLabel('inclination'), 'i / °');
  assert.equal(formatElementLabel('argPeriapsis'), 'ω / °');
  assert.equal(formatElementLabel('trueAnomaly'), 'ν / °');
});

test('formats orbit period with seconds, minutes and hours', () => {
  assert.equal(formatDuration(3600), '3,600.00 s (60.00 min / 1.00 h)');
});

test('normalizes angle fields into radians while preserving km inputs', () => {
  const elements = normalizeElements({
    name: 'Inclined LEO',
    semiMajorAxisKm: 7000,
    eccentricity: 0.001,
    inclinationDeg: 51.6,
    raanDeg: 40,
    argPeriapsisDeg: 30,
    trueAnomalyDeg: 0,
  });

  assert.equal(elements.semiMajorAxisKm, 7000);
  assert.equal(elements.eccentricity, 0.001);
  nearlyEqual(elements.inclinationRad, 0.900589894, 1e-9, 'inclination radians');
  nearlyEqual(elements.raanRad, 0.698131701, 1e-9, 'Ω radians');
  nearlyEqual(elements.argPeriapsisRad, 0.523598776, 1e-9, 'ω radians');
  nearlyEqual(elements.trueAnomalyRad, 0, 1e-12, 'ν radians');
});

test('computes core elliptical orbit outputs for a circular 7000 km orbit', () => {
  const orbit = computeOrbit({
    name: 'Circular LEO',
    semiMajorAxisKm: 7000,
    eccentricity: 0,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });

  nearlyEqual(orbit.periodSeconds, 5828.51664, 1e-3, 'period');
  nearlyEqual(orbit.periapsisAltitudeKm, 7000 - EARTH_RADIUS_KM, 1e-9, 'periapsis altitude');
  nearlyEqual(orbit.apoapsisAltitudeKm, 7000 - EARTH_RADIUS_KM, 1e-9, 'apoapsis altitude');
  nearlyEqual(orbit.speedRangeKmS.min, Math.sqrt(MU_EARTH_KM3_S2 / 7000), 1e-9, 'min speed');
  nearlyEqual(orbit.speedRangeKmS.max, Math.sqrt(MU_EARTH_KM3_S2 / 7000), 1e-9, 'max speed');
});

test('propagates state vectors in ECI for a quarter period circular equatorial orbit', () => {
  const orbit = computeOrbit({
    name: 'Circular LEO',
    semiMajorAxisKm: 7000,
    eccentricity: 0,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });

  const state = propagateOrbit(orbit, orbit.periodSeconds / 4);
  nearlyEqual(state.positionKm.x, 0, 1e-6, 'x after quarter period');
  nearlyEqual(state.positionKm.y, 7000, 1e-6, 'y after quarter period');
  nearlyEqual(state.positionKm.z, 0, 1e-6, 'z after quarter period');
  nearlyEqual(state.velocityKmS.x, -Math.sqrt(MU_EARTH_KM3_S2 / 7000), 1e-6, 'vx after quarter period');
  nearlyEqual(state.velocityKmS.y, 0, 1e-6, 'vy after quarter period');
});

test('samples reference orbit points with near-uniform arc-length spacing', () => {
  const orbit = computeOrbit({
    name: 'Eccentric Arc Length',
    semiMajorAxisKm: 18000,
    eccentricity: 0.45,
    inclinationDeg: 28.5,
    raanDeg: 40,
    argPeriapsisDeg: 15,
    trueAnomalyDeg: 0,
  });

  const samples = sampleOrbit(orbit, 180, { perturbationModel: 'two-body' });
  const distances = samples.map((sample, index) => {
    const next = samples[(index + 1) % samples.length];
    return vectorMagnitude({
      x: next.positionKm.x - sample.positionKm.x,
      y: next.positionKm.y - sample.positionKm.y,
      z: next.positionKm.z - sample.positionKm.z,
    });
  });
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  const elapsedGaps = samples.slice(1).map((sample, index) => sample.elapsedSeconds - samples[index].elapsedSeconds);
  const minElapsedGap = Math.min(...elapsedGaps);
  const maxElapsedGap = Math.max(...elapsedGaps);

  assert.equal(samples.length, 180);
  assert.ok(samples.every((sample) => Number.isFinite(sample.elapsedSeconds)));
  assert.ok(max / min < 1.08, `arc-length spacing should be visually uniform, got ratio ${max / min}`);
  assert.ok(maxElapsedGap / minElapsedGap > 1.2, 'eccentric arc-length samples should not be uniformly spaced in time');
});

test('J2 propagation applies nodal regression for inclined prograde orbits', () => {
  const orbit = computeOrbit({
    name: 'J2 LEO',
    semiMajorAxisKm: 7200,
    eccentricity: 0.01,
    inclinationDeg: 63.4,
    raanDeg: 40,
    argPeriapsisDeg: 25,
    trueAnomalyDeg: 5,
  });

  const twoBody = propagateOrbit(orbit, 86400, { perturbationModel: 'two-body' });
  const j2 = propagateOrbit(orbit, 86400, { perturbationModel: 'j2' });

  assert.equal(j2.perturbationModel, 'j2');
  assert.ok(j2.elements.raanRad < orbit.elements.raanRad, 'J2 should regress Ω for a prograde orbit');
  assert.ok(vectorMagnitude({
    x: j2.positionKm.x - twoBody.positionKm.x,
    y: j2.positionKm.y - twoBody.positionKm.y,
    z: j2.positionKm.z - twoBody.positionKm.z,
  }) > 1, 'J2 state should differ from two-body propagation after one day');
});

test('J3 propagation is finite and distinct from J2 for eccentric inclined orbits', () => {
  const orbit = computeOrbit({
    name: 'J3 HEO',
    semiMajorAxisKm: 18000,
    eccentricity: 0.35,
    inclinationDeg: 63.4,
    raanDeg: 181.2,
    argPeriapsisDeg: 250,
    trueAnomalyDeg: 10,
  });

  const j2 = propagateOrbit(orbit, 3 * 86400, { perturbationModel: 'j2' });
  const j3 = propagateOrbit(orbit, 3 * 86400, { perturbationModel: 'j3' });
  const deltaKm = vectorMagnitude({
    x: j3.positionKm.x - j2.positionKm.x,
    y: j3.positionKm.y - j2.positionKm.y,
    z: j3.positionKm.z - j2.positionKm.z,
  });

  assert.equal(j3.perturbationModel, 'j3');
  assert.ok(Number.isFinite(j3.positionKm.x));
  assert.ok(Number.isFinite(j3.velocityKmS.z));
  assert.ok(deltaKm > 0.001, 'J3 model should produce a distinct finite state');
});

test('normalizes unsupported perturbation model values to two-body', () => {
  assert.equal(normalizePerturbationModel('j2'), 'j2');
  assert.equal(normalizePerturbationModel('j3'), 'j3');
  assert.equal(normalizePerturbationModel('bad-model'), 'two-body');
});

test('rejects unsupported or unsafe first-version inputs', () => {
  assert.deepEqual(validateElements({ semiMajorAxisKm: 7000, eccentricity: 1 }).valid, false);
  assert.deepEqual(validateElements({ semiMajorAxisKm: 6378, eccentricity: 0.01 }).valid, false);
  assert.deepEqual(validateElements({ semiMajorAxisKm: -1, eccentricity: 0.1 }).valid, false);
});
