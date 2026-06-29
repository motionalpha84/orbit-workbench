import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVelocityHitPayload,
  formatVelocityNumber,
  velocityBounds,
  velocitySceneScale,
  velocityVectorToScene,
  VelocityCircleView,
} from '../js/velocity-circle-view.mjs';

const track = {
  id: 'orbit-a',
  name: 'Orbit A',
  color: '#7fd1c7',
  current: {
    elapsedSeconds: 42,
    speedKmS: 7.654321,
    velocityKmS: { x: 1.2, y: -2.4, z: 7.1 },
    perturbationModel: 'j2',
  },
  samples: [
    { velocityKmS: { x: 1, y: 0, z: 0 }, speedKmS: 1 },
    { velocityKmS: { x: 0, y: -3, z: 0 }, speedKmS: 3 },
    { velocityKmS: { x: 0, y: 0, z: 6 }, speedKmS: 6 },
  ],
  trail: [
    { velocityKmS: { x: 1, y: 1, z: 1 }, speedKmS: 1.732 },
  ],
};

test('formats velocity numbers for compact tooltip display', () => {
  assert.equal(formatVelocityNumber(7.654321, 3), '7.654');
  assert.equal(formatVelocityNumber(Number.NaN), '--');
});

test('computes finite velocity bounds from samples, current vectors, and trails', () => {
  const bounds = velocityBounds([track]);
  assert.equal(bounds.maxAbsComponent, 7.1);
  assert.equal(bounds.maxSpeedKmS, 7.654321);
  assert.ok(bounds.radiusKmS >= 7.654321);
});

test('computes a nonzero scene scale for velocity-space rendering', () => {
  const scale = velocitySceneScale(velocityBounds([track]));
  assert.ok(scale > 0);
  const point = velocityVectorToScene(track.current.velocityKmS, scale);
  assert.ok(Number.isFinite(point.x));
  assert.ok(Number.isFinite(point.y));
  assert.ok(Number.isFinite(point.z));
});

test('builds hover payloads with orbit name, speed, vector components, and dynamics model', () => {
  const payload = buildVelocityHitPayload(track, track.current);
  assert.equal(payload.id, 'orbit-a');
  assert.equal(payload.name, 'Orbit A');
  assert.equal(payload.speedKmS, 7.654321);
  assert.equal(payload.perturbationModel, 'j2');
  assert.deepEqual(payload.velocityKmS, { x: 1.2, y: -2.4, z: 7.1 });
});

test('view methods are safe when no canvas is available', () => {
  const view = new VelocityCircleView({});
  assert.doesNotThrow(() => view.setPanelOpen(false));
  assert.doesNotThrow(() => view.setFullscreen(true));
  assert.doesNotThrow(() => view.setData([track], { selectedIds: ['orbit-a'], elapsedSeconds: 42 }));
  assert.equal(view.capturePng({ width: 320, height: 180 }), '');
});
