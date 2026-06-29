import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';

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

test('fixed-size PNG capture uses pixel ratio 1 and restores renderer size and camera projection', () => {
  const calls = [];
  const view = new VelocityCircleView({});
  view.canvas = { width: 1280, height: 720 };
  view.scene = {};
  view.camera = {
    aspect: 1.25,
    updateProjectionMatrix() {
      calls.push(['updateProjectionMatrix', this.aspect]);
    },
  };
  view.renderer = {
    domElement: {
      toDataURL: () => 'data:image/png;base64,ok',
    },
    getPixelRatio: () => 2,
    setPixelRatio: (ratio) => calls.push(['setPixelRatio', ratio]),
    getSize: (target) => target.set(640, 360),
    setSize: (width, height, updateStyle) => calls.push(['setSize', width, height, updateStyle]),
    render: () => calls.push(['render']),
  };

  assert.equal(view.capturePng({ width: 1920, height: 1080 }), 'data:image/png;base64,ok');
  assert.deepEqual(calls, [
    ['setPixelRatio', 1],
    ['updateProjectionMatrix', 1920 / 1080],
    ['setSize', 1920, 1080, false],
    ['render'],
    ['setPixelRatio', 2],
    ['updateProjectionMatrix', 1.25],
    ['setSize', 640, 360, false],
  ]);
});

test('reference and trail lines are registered as hover targets with velocity payloads', () => {
  const view = new VelocityCircleView({});
  view.trackRoot = new THREE.Group();
  view.setData([track], { selectedIds: ['orbit-a'], elapsedSeconds: 42 });

  const lineTargets = view.pickTargets.filter((target) => target.isLine);
  assert.ok(lineTargets.length >= 2);
  for (const target of lineTargets) {
    assert.equal(target.userData.velocityHit.id, 'orbit-a');
    assert.equal(target.userData.velocityHit.speedKmS, 7.654321);
  }
});

test('tooltip is positioned in canvas-local coordinates', () => {
  const tooltip = { innerHTML: '', hidden: true, style: {} };
  const view = new VelocityCircleView({
    canvas: {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 240 }),
      clientWidth: 400,
      clientHeight: 240,
    },
    tooltip,
  });

  view.showTooltip(buildVelocityHitPayload(track, track.current), { clientX: 140, clientY: 90 });

  assert.equal(tooltip.style.left, '54px');
  assert.equal(tooltip.style.top, '54px');
});
