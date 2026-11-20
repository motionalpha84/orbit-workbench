import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OrbitScene, vectorToScene } from '../js/scene.mjs';
import { computeOrbit } from '../js/orbit.mjs';

function sceneHarness() {
  const scene = Object.create(OrbitScene.prototype);
  Object.assign(scene, {
    root: new THREE.Group(),
    orbitGroups: new Map(),
    computedRecords: new Map(),
    selectedOrbitIds: new Set(),
    showReference: true,
    perturbationModel: 'two-body',
    elapsedSeconds: 0,
  });
  return scene;
}

function orbitRecord() {
  return {
    id: 'orbit-1', name: 'Reference', color: '#82dfce', visible: true,
    orbit: computeOrbit({
      semiMajorAxisKm: 7000, eccentricity: 0.01, inclinationDeg: 30,
      raanDeg: 10, argPeriapsisDeg: 20, trueAnomalyDeg: 0,
    }),
  };
}

test('scene waits for backend references and refreshes when their array is replaced', () => {
  const scene = sceneHarness();
  const record = orbitRecord();
  scene.syncOrbits([record]);
  const group = scene.orbitGroups.get(record.id);
  assert.equal(group.reference.geometry.getAttribute('position').count, 0);
  assert.equal(group.marker.visible, false);

  record.reference = [{ positionKm: { x: 7000, y: 0, z: 0 } }];
  scene.syncOrbits([record]);
  const geometry = group.reference.geometry;
  assert.equal(geometry.getAttribute('position').count, 1);
  scene.syncOrbits([record]);
  assert.equal(group.reference.geometry, geometry, 'unchanged arrays reuse GPU geometry');

  record.reference = [{ positionKm: { x: 0, y: 7000, z: 0 } }];
  scene.syncOrbits([record]);
  assert.notEqual(group.reference.geometry, geometry);
  assert.ok(group.reference.geometry.getAttribute('position').getZ(0) < -1);
});

test('scene uses backend marker and tail samples and invalidates them explicitly', () => {
  const scene = sceneHarness();
  const record = orbitRecord();
  scene.syncOrbits([record]);
  const current = { x: 200, y: 7000, z: -10 };
  scene.setComputedFrame({ elapsedSeconds: 40, records: [{
    id: record.id, state: { positionKm: current },
    trail: [{ x: 100, y: 6900, z: 0 }, current],
  }] });
  const group = scene.orbitGroups.get(record.id);
  assert.deepEqual(group.marker.position, vectorToScene(current));
  assert.equal(group.marker.visible, true);
  assert.equal(group.tail.geometry.drawRange.count, 2);
  assert.equal(scene.elapsedSeconds, 40);
  assert.ok(group.tail.geometry.boundingSphere.radius > 0);
  scene.setComputedFrame(null);
  assert.equal(group.marker.visible, false);
  assert.equal(group.tail.visible, false);
});

test('scene applies an already received frame when a prepared orbit is mounted', () => {
  const scene = sceneHarness();
  const record = orbitRecord();
  const current = { x: 100, y: 7200, z: 0 };
  scene.setComputedFrame({ elapsedSeconds: 5, records: [{ id: record.id, state: { positionKm: current }, trail: [current] }] });
  scene.syncOrbits([record]);
  assert.deepEqual(scene.orbitGroups.get(record.id).marker.position, vectorToScene(current));
});

test('editing orbital elements hides stale computed state and updates orbit colors', () => {
  const scene = sceneHarness();
  const record = orbitRecord();
  scene.syncOrbits([record]);
  scene.setComputedFrame({ records: [{ id: record.id, state: { positionKm: { x: 7000, y: 0, z: 0 } }, trail: [] }] });
  record.orbit = computeOrbit({ ...record.orbit.elements, inclinationDeg: 50 });
  record.color = '#f1d887';
  scene.syncOrbits([record]);
  const group = scene.orbitGroups.get(record.id);
  assert.equal(group.marker.visible, false);
  assert.equal(group.marker.material.color.getHexString(), 'f1d887');
  assert.equal(scene.computedRecords.has(record.id), false);
});

test('render frames keep the last computed geometry without rebuilding orbital data', () => {
  const scene = sceneHarness();
  const record = orbitRecord();
  scene.syncOrbits([record]);
  const current = { x: 7000, y: 0, z: 0 };
  scene.setComputedFrame({ records: [{ id: record.id, state: { positionKm: current }, trail: [current] }] });
  const group = scene.orbitGroups.get(record.id);
  const positions = group.tail.geometry.getAttribute('position');
  const version = positions.version;
  scene.frame = 'ECI';
  scene.earthBody = new THREE.Group();
  scene.axesGroup = new THREE.Group();
  scene.controls = { update() {} };
  scene.render = () => {};
  scene.syncOrbits = () => { throw new Error('render loop must not rebuild orbits'); };
  scene.update([record], 60);
  assert.equal(positions.version, version);
  assert.deepEqual(group.marker.position, vectorToScene(current));
  assert.equal(group.tail.material.uniforms.time.value, 60);
});
