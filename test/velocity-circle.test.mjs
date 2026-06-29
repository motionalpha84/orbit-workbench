import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeOrbit,
  propagateOrbit,
  vectorMagnitude,
} from '../js/orbit.mjs';
import {
  sampleVelocityCircle,
  sampleVelocityCircles,
  velocityMagnitudeKmS,
  velocityTrailSpanSeconds,
} from '../js/velocity-circle.mjs';

const nearlyEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
};

function orbitRecord(overrides = {}) {
  const orbit = computeOrbit({
    name: 'Velocity Test',
    semiMajorAxisKm: 7200,
    eccentricity: 0.08,
    inclinationDeg: 42,
    raanDeg: 18,
    argPeriapsisDeg: 64,
    trueAnomalyDeg: 12,
    ...overrides,
  });
  return {
    id: overrides.id ?? 'velocity-test',
    name: overrides.name ?? 'Velocity Test',
    color: overrides.color ?? '#7fd1c7',
    visible: overrides.visible ?? true,
    orbit,
  };
}

test('computes velocity magnitude from km/s vector components', () => {
  nearlyEqual(velocityMagnitudeKmS({ x: 3, y: 4, z: 12 }), 13, 1e-12, 'speed magnitude');
  assert.equal(velocityMagnitudeKmS({ x: NaN, y: 1, z: 2 }), 0);
});

test('samples a future one-revolution velocity circle from current simulation time', () => {
  const record = orbitRecord();
  const elapsedSeconds = 1200;
  const track = sampleVelocityCircle({
    orbitRecord: record,
    elapsedSeconds,
    perturbationModel: 'two-body',
    sampleCount: 32,
    trailSampleCount: 8,
  });
  const current = propagateOrbit(record.orbit, elapsedSeconds, { perturbationModel: 'two-body' });

  assert.equal(track.id, record.id);
  assert.equal(track.name, record.name);
  assert.equal(track.color, record.color);
  assert.equal(track.samples.length, 33);
  assert.equal(track.trail.length, 8);
  assert.equal(track.perturbationModel, 'two-body');
  nearlyEqual(track.current.velocityKmS.x, current.velocityKmS.x, 1e-10, 'current vx');
  nearlyEqual(track.current.velocityKmS.y, current.velocityKmS.y, 1e-10, 'current vy');
  nearlyEqual(track.current.velocityKmS.z, current.velocityKmS.z, 1e-10, 'current vz');
  nearlyEqual(track.speedKmS, vectorMagnitude(current.velocityKmS), 1e-10, 'current speed');
  assert.equal(track.samples[0].elapsedSeconds, elapsedSeconds);
  nearlyEqual(track.samples.at(-1).elapsedSeconds, elapsedSeconds + record.orbit.periodSeconds, 1e-9, 'future circle endpoint');
  assert.ok(track.samples.every((point) => Number.isFinite(point.velocityKmS.x)));
  assert.ok(track.samples.every((point) => Number.isFinite(point.speedKmS)));
});

test('builds a short trail that ends at the current velocity endpoint', () => {
  const record = orbitRecord();
  const elapsedSeconds = 850;
  const track = sampleVelocityCircle({
    orbitRecord: record,
    elapsedSeconds,
    sampleCount: 24,
    trailSampleCount: 6,
  });

  assert.equal(track.trail.length, 6);
  assert.ok(track.trail[0].elapsedSeconds < elapsedSeconds);
  assert.equal(track.trail.at(-1).elapsedSeconds, elapsedSeconds);
  nearlyEqual(track.trail.at(-1).velocityKmS.x, track.current.velocityKmS.x, 1e-12, 'trail end vx');
  assert.ok(velocityTrailSpanSeconds(record.orbit) > 0);
});

test('honors small positive sample count requests', () => {
  const record = orbitRecord();
  const elapsedSeconds = 300;
  const track = sampleVelocityCircle({
    orbitRecord: record,
    elapsedSeconds,
    sampleCount: 3,
    trailSampleCount: 1,
  });

  assert.equal(track.samples.length, 4);
  assert.equal(track.trail.length, 1);
  assert.equal(track.trail[0].elapsedSeconds, elapsedSeconds);
  nearlyEqual(track.samples.at(-1).elapsedSeconds, elapsedSeconds + record.orbit.periodSeconds, 1e-9, 'small sample endpoint');
});

test('passes perturbation models through to every sampled point', () => {
  const record = orbitRecord({ semiMajorAxisKm: 8200, eccentricity: 0.18, inclinationDeg: 63.4 });
  for (const perturbationModel of ['j2', 'j3']) {
    const track = sampleVelocityCircle({
      orbitRecord: record,
      elapsedSeconds: 86400,
      perturbationModel,
      sampleCount: 18,
      trailSampleCount: 4,
    });
    assert.equal(track.current.perturbationModel, perturbationModel);
    assert.ok(track.samples.every((point) => point.perturbationModel === perturbationModel));
    assert.ok(track.trail.every((point) => point.perturbationModel === perturbationModel));
  }
});

test('samples multiple visible records and skips invalid records', () => {
  const first = orbitRecord({ id: 'first', name: 'First' });
  const second = orbitRecord({ id: 'second', name: 'Second', semiMajorAxisKm: 14000, eccentricity: 0.22 });
  const tracks = sampleVelocityCircles([first, null, second, { id: 'bad' }], {
    elapsedSeconds: 400,
    perturbationModel: 'two-body',
    sampleCount: 12,
    trailSampleCount: 3,
  });

  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks.map((track) => track.id), ['first', 'second']);
  assert.ok(tracks.every((track) => track.samples.length === 13));
  assert.ok(tracks.every((track) => track.trail.length === 3));
});

test('returns null and skips malformed orbit records that cannot propagate', () => {
  const valid = orbitRecord({ id: 'valid', name: 'Valid' });
  const malformed = { id: 'bad', orbit: { periodSeconds: 100 } };

  assert.equal(sampleVelocityCircle({ orbitRecord: malformed, elapsedSeconds: 10 }), null);

  const tracks = sampleVelocityCircles([valid, malformed], {
    elapsedSeconds: 10,
    sampleCount: 3,
    trailSampleCount: 1,
  });

  assert.deepEqual(tracks.map((track) => track.id), ['valid']);
});
