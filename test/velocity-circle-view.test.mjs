import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';

import * as velocityCircleViewModule from '../js/velocity-circle-view.mjs';

const {
  buildVelocityHitPayload,
  formatVelocityNumber,
  velocityBounds,
  velocitySceneScale,
  velocityVectorToScene,
  VelocityCircleView,
} = velocityCircleViewModule;

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
    { elapsedSeconds: 40, velocityKmS: { x: 1, y: 0, z: 0 }, speedKmS: 1, perturbationModel: 'j2' },
    { elapsedSeconds: 41, velocityKmS: { x: 0, y: -3, z: 0 }, speedKmS: 3, perturbationModel: 'j2' },
    { elapsedSeconds: 42, velocityKmS: { x: 0, y: 0, z: 6 }, speedKmS: 6, perturbationModel: 'j2' },
  ],
  trail: [
    { elapsedSeconds: 37, velocityKmS: { x: 1, y: 1, z: 1 }, speedKmS: 1.732, perturbationModel: 'j2' },
    { elapsedSeconds: 39, velocityKmS: { x: 1.1, y: 1.1, z: 1.1 }, speedKmS: 1.905, perturbationModel: 'j2' },
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

test('closing an already inactive panel does not redraw', () => {
  const calls = [];
  const view = new VelocityCircleView({});
  view.scene = {};
  view.camera = {};
  view.renderer = {
    render: () => calls.push('render'),
  };

  view.setPanelOpen(false);
  view.setPanelOpen(false);

  assert.deepEqual(calls, []);
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

test('pointer capture release is guarded for uncaptured leave and up paths', () => {
  const listeners = new Map();
  const capturedPointers = new Set();
  let releaseCount = 0;
  const canvas = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    hasPointerCapture(pointerId) {
      return capturedPointers.has(pointerId);
    },
    releasePointerCapture(pointerId) {
      if (!capturedPointers.has(pointerId)) {
        throw new Error(`release without capture: ${pointerId}`);
      }
      capturedPointers.delete(pointerId);
      releaseCount += 1;
    },
  };
  const view = new VelocityCircleView({ canvas });

  view.bindEvents();

  assert.doesNotThrow(() => listeners.get('pointerleave')({ pointerId: 7 }));
  assert.doesNotThrow(() => view.onPointerUp({ pointerId: 8 }));
  capturedPointers.add(9);
  assert.doesNotThrow(() => view.onPointerUp({ pointerId: 9 }));
  assert.equal(releaseCount, 1);
});

test('line hover helper derives payload from the nearest sampled velocity point', () => {
  const helper = velocityCircleViewModule.velocityHitPayloadForIntersection;
  assert.equal(typeof helper, 'function');

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(20, 0, 0),
    ]),
    new THREE.LineBasicMaterial(),
  );
  line.userData.velocityHit = { elapsedSeconds: 999, speedKmS: 999 };
  line.userData.velocityHitPayloads = [
    { elapsedSeconds: 0, speedKmS: 1 },
    { elapsedSeconds: 10, speedKmS: 2 },
    { elapsedSeconds: 20, speedKmS: 3 },
  ];

  const payload = helper({
    object: line,
    index: 0,
    point: new THREE.Vector3(9.6, 0, 0),
  });

  assert.equal(payload.elapsedSeconds, 10);
  assert.equal(payload.speedKmS, 2);
});

test('reference and trail lines are registered as hover targets with sampled velocity payloads', () => {
  const view = new VelocityCircleView({});
  view.trackRoot = new THREE.Group();
  view.setData([track], { selectedIds: ['orbit-a'], elapsedSeconds: 42 });

  const sampledLineTargets = view.pickTargets.filter(
    (target) => target.isLine && Array.isArray(target.userData.velocityHitPayloads),
  );
  assert.equal(sampledLineTargets.length, 2);
  assert.ok(sampledLineTargets.some((target) => target.userData.velocityHitPayloads.length === track.samples.length));
  assert.ok(sampledLineTargets.some((target) => target.userData.velocityHitPayloads.length === track.trail.length));

  const referenceLine = sampledLineTargets.find((target) => target.userData.velocityHitPayloads.length === track.samples.length);
  assert.deepEqual(
    referenceLine.userData.velocityHitPayloads.map((payload) => payload.elapsedSeconds),
    track.samples.map((point) => point.elapsedSeconds),
  );
  assert.deepEqual(
    referenceLine.userData.velocityHitPayloads.map((payload) => payload.speedKmS),
    track.samples.map((point) => point.speedKmS),
  );
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

test('hover readout uses nearest sampled payload for reference lines', () => {
  const view = new VelocityCircleView({
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      clientWidth: 100,
      clientHeight: 100,
    },
  });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(20, 0, 0),
    ]),
    new THREE.LineBasicMaterial(),
  );
  line.userData.velocityHit = { elapsedSeconds: 999, speedKmS: 999 };
  line.userData.velocityHitPayloads = [
    { elapsedSeconds: 0, speedKmS: 1 },
    { elapsedSeconds: 10, speedKmS: 2 },
    { elapsedSeconds: 20, speedKmS: 3 },
  ];
  view.camera = {};
  view.pointer = new THREE.Vector2();
  view.pickTargets = [line];
  view.raycaster = {
    setFromCamera() {},
    intersectObjects() {
      return [{
        object: line,
        index: 0,
        point: new THREE.Vector3(9.6, 0, 0),
      }];
    },
  };
  let shownPayload = null;
  view.showTooltip = (payload) => {
    shownPayload = payload;
  };

  view.updateHover({ clientX: 50, clientY: 50 });

  assert.equal(shownPayload.elapsedSeconds, 10);
  assert.equal(shownPayload.speedKmS, 2);
});

test('hover exit restores the default readout text', () => {
  const defaultReadout = '悬停速度矢量后显示读数。';
  const readout = { innerHTML: defaultReadout, hidden: false };
  const view = new VelocityCircleView({
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 240 }),
      clientWidth: 400,
      clientHeight: 240,
    },
    readout,
  });

  view.showTooltip(buildVelocityHitPayload(track, track.current), { clientX: 140, clientY: 90 });
  assert.notEqual(readout.innerHTML, defaultReadout);

  view.hideTooltip();

  assert.equal(readout.innerHTML, defaultReadout);
  assert.equal(readout.hidden, false);
});
