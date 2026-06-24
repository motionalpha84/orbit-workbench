import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from '../vendor/three.module.js';
import {
  arcballQuaternion,
  cameraPanOffset,
  EARTH_SIDEREAL_DAY_SECONDS,
  earthRotationAngleAt,
  frameAxesRotationAngleAt,
  orbitReferenceSampleCount,
  playbackSampleAt,
  projectPointerToArcball,
  referencePointsSignature,
  renderTimingAngles,
} from '../js/scene.mjs';
import { computeOrbit } from '../js/orbit.mjs';

const nearlyEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
};

test('projects the canvas center to the front of the virtual arcball', () => {
  const vector = projectPointerToArcball(400, 300, 800, 600);

  nearlyEqual(vector.x, 0, 1e-12, 'center x');
  nearlyEqual(vector.y, 0, 1e-12, 'center y');
  nearlyEqual(vector.z, 1, 1e-12, 'center z');
  nearlyEqual(vector.length(), 1, 1e-12, 'center vector length');
});

test('projects far outside the arcball to a normalized rim vector', () => {
  const vector = projectPointerToArcball(1200, 300, 800, 600);

  nearlyEqual(vector.length(), 1, 1e-12, 'rim vector length');
  nearlyEqual(vector.z, 0, 1e-12, 'rim vector z');
  assert.ok(vector.x > 0.999, 'rim vector should point toward the drag direction');
});

test('builds a normalized quaternion that rotates between arcball vectors', () => {
  const from = projectPointerToArcball(400, 300, 800, 600);
  const to = projectPointerToArcball(400, 0, 800, 600);
  const quaternion = arcballQuaternion(from, to);
  const rotated = from.clone().applyQuaternion(quaternion);

  nearlyEqual(quaternion.length(), 1, 1e-12, 'quaternion length');
  nearlyEqual(rotated.x, to.x, 1e-12, 'rotated x');
  nearlyEqual(rotated.y, to.y, 1e-12, 'rotated y');
  nearlyEqual(rotated.z, to.z, 1e-12, 'rotated z');
});

test('computes a camera-space pan offset that makes dragged content follow the pointer', () => {
  const cameraRotation = new THREE.Quaternion();
  const offset = cameraPanOffset(20, 10, 600, 5, 44, cameraRotation);

  assert.ok(offset.x < 0, 'dragging right should move the camera left so content follows the pointer');
  assert.ok(offset.y > 0, 'dragging down should move the camera up so content follows the pointer');
  nearlyEqual(offset.z, 0, 1e-12, 'pan should stay in the camera image plane');
});

test('computes Earth rotation from simulation time using a sidereal day', () => {
  nearlyEqual(earthRotationAngleAt(0), 0, 1e-12, 'zero time angle');
  nearlyEqual(earthRotationAngleAt(EARTH_SIDEREAL_DAY_SECONDS / 2), Math.PI, 1e-12, 'half sidereal day angle');
  nearlyEqual(earthRotationAngleAt(EARTH_SIDEREAL_DAY_SECONDS), 0, 1e-12, 'full sidereal day wraps');
});

test('rotates only ECEF axes with Earth sidereal time', () => {
  const quarterDay = EARTH_SIDEREAL_DAY_SECONDS / 4;

  nearlyEqual(frameAxesRotationAngleAt('ECI', quarterDay), 0, 1e-12, 'ECI axes stay inertial');
  nearlyEqual(frameAxesRotationAngleAt('ECEF', quarterDay), Math.PI / 2, 1e-12, 'ECEF axes rotate with Earth');
});

test('derives playback timing angles from the current elapsed seconds', () => {
  const quarterDay = EARTH_SIDEREAL_DAY_SECONDS / 4;
  const angles = renderTimingAngles('ECEF', quarterDay);

  nearlyEqual(angles.earthRotationAngleRad, Math.PI / 2, 1e-12, 'earth angle follows elapsed time');
  nearlyEqual(angles.frameAxesRotationAngleRad, Math.PI / 2, 1e-12, 'ECEF axes follow elapsed time');
});

test('builds a stable signature for reference point payloads', () => {
  const points = [
    { elapsedSeconds: 0, scenePoint: { x: 1, y: 2, z: 3 } },
    { elapsedSeconds: 10, scenePoint: { x: 4, y: 5, z: 6 } },
  ];

  assert.equal(referencePointsSignature(points), referencePointsSignature(points));
  assert.notEqual(referencePointsSignature(points), referencePointsSignature(points.slice(0, 1)));
});

test('uses more reference samples for larger orbits to keep visual point density stable', () => {
  const smallOrbit = computeOrbit({
    semiMajorAxisKm: 7000,
    eccentricity: 0.001,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });
  const largeOrbit = computeOrbit({
    semiMajorAxisKm: 60000,
    eccentricity: 0.1,
    inclinationDeg: 0,
    raanDeg: 0,
    argPeriapsisDeg: 0,
    trueAnomalyDeg: 0,
  });

  assert.ok(orbitReferenceSampleCount(largeOrbit) > orbitReferenceSampleCount(smallOrbit));
  assert.ok(orbitReferenceSampleCount(smallOrbit) >= 180);
  assert.ok(orbitReferenceSampleCount(largeOrbit) <= 2400);
});

test('interpolates playback samples by wrapped elapsed seconds', () => {
  const samples = [
    { elapsedSeconds: 0, scenePoint: { x: 0, y: 0, z: 0 } },
    { elapsedSeconds: 10, scenePoint: { x: 10, y: 0, z: 0 } },
  ];

  const mid = playbackSampleAt(samples, 5, 20);
  const wrapped = playbackSampleAt(samples, 15, 20);

  nearlyEqual(mid.scenePoint.x, 5, 1e-12, 'midpoint x');
  nearlyEqual(wrapped.scenePoint.x, 5, 1e-12, 'wrapped x');
});
