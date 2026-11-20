import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OrbitBatchRenderer, ORBIT_BATCH_THRESHOLD, PointSpatialIndex } from '../js/orbit-batch.mjs';
import { OrbitScene, vectorToScene } from '../js/scene.mjs';

function records(count, referenceCount = 4) {
  return Array.from({ length: count }, (_, slot) => ({
    id: `orbit-${slot}`, name: `Orbit ${slot}`, color: slot % 2 ? '#f1d887' : '#82dfce', visible: true,
    orbit: { elements: { semiMajorAxisKm: 7000, eccentricity: 0.01, inclinationDeg: slot % 80, raanDeg: 10, argPeriapsisDeg: 20, trueAnomalyDeg: 0 } },
    reference: Array.from({ length: referenceCount }, (_, index) => ({
      positionKm: { x: 7000 + slot, y: index * 20, z: slot * 10 },
    })),
  }));
}

function frame(source) {
  return new Map(source.map((record, index) => [record.id, {
    id: record.id,
    state: { positionKm: { x: 7000.123456789 + index, y: 20.123456789, z: -10.987654321 } },
    trail: [{ x: 6900, y: 0, z: index }, { x: 7000, y: 20, z: index }],
  }]));
}

function sceneHarness() {
  return Object.assign(Object.create(OrbitScene.prototype), {
    root: new THREE.Group(), orbitGroups: new Map(), computedRecords: new Map(),
    selectedOrbitIds: new Set(), showReference: true,
    perturbationModel: 'two-body', elapsedSeconds: 0,
  });
}

test('batch renderer preserves every server reference and state in three draw calls', () => {
  const source = records(1000, 180);
  const computed = frame(source);
  const before = computed.get(source[0].id).state.positionKm.x;
  const batch = new OrbitBatchRenderer();
  batch.setRecords(source);
  batch.updateFrame(computed, 123);
  assert.equal(batch.root.children.length, 3);
  assert.equal(batch.stats().orbitDrawCallBudget, 3);
  assert.equal(batch.stats().referencePoints, 180000);
  assert.equal(batch.stats().trailPoints, 2000);
  assert.equal(batch.stats().markerSlots, 1000);
  const position = vectorToScene(computed.get(source[0].id).state.positionKm);
  const attribute = batch.parts.marker.object.geometry.attributes.position;
  assert.equal(attribute.getX(0), Math.fround(position.x));
  assert.equal(attribute.getY(0), Math.fround(position.y));
  assert.equal(attribute.getZ(0), Math.fround(position.z));
  assert.equal(computed.get(source[0].id).state.positionKm.x, before, 'source telemetry stays double precision');
  assert.equal(batch.parts.tail.object.material.uniforms.time.value, 123);
  batch.dispose();
});

test('selection, visibility, and color changes update per-orbit styles without rebuilding references', () => {
  const source = records(4);
  const batch = new OrbitBatchRenderer();
  batch.setRecords(source);
  const geometry = batch.parts.reference.object.geometry;
  const revision = batch.geometryRevision;
  source[1].visible = false;
  source[2].color = '#ffffff';
  batch.setRecords(source, new Set(['orbit-0', 'orbit-2']), false);
  assert.equal(batch.geometryRevision, revision);
  assert.equal(batch.parts.reference.object.geometry, geometry);
  assert.equal(batch.parts.reference.object.visible, false);
  const styles = batch.styleTexture.image.data;
  assert.deepEqual([styles[3], styles[7], styles[11], styles[15]], [2, 0, 2, 3]);
  assert.deepEqual(Array.from(styles.slice(8, 11)), [1, 1, 1]);
  batch.setFocus(new Set(['removed-id']));
  assert.deepEqual([styles[3], styles[7], styles[11], styles[15]], [1, 0, 1, 1]);
  batch.dispose();
});

test('references are invalidated by replaced server arrays and by orbit ordering', () => {
  const source = records(2);
  const batch = new OrbitBatchRenderer();
  batch.setRecords(source);
  const initialRevision = batch.geometryRevision;
  source[0].reference = [{ positionKm: { x: 0, y: 7000, z: 0 } }];
  batch.setRecords(source);
  assert.equal(batch.geometryRevision, initialRevision + 1);
  assert.equal(batch.parts.reference.count, 5);
  assert.equal(batch.parts.reference.object.geometry.attributes.position.getZ(0), Math.fround(-7000 / 6378.137));
  batch.setRecords([...source].reverse());
  assert.equal(batch.geometryRevision, initialRevision + 2);
  assert.equal(batch.records[0].id, source[1].id);
  batch.dispose();
});

test('missing frame states hide markers and trails while render-time changes do not rebuild data', () => {
  const source = records(3);
  const batch = new OrbitBatchRenderer();
  batch.setRecords(source);
  batch.updateFrame(frame(source));
  const positions = batch.parts.tail.object.geometry.attributes.position;
  const version = positions.version;
  const revision = batch.frameRevision;
  batch.setTime(456);
  assert.equal(positions.version, version);
  assert.equal(batch.frameRevision, revision);
  assert.equal(batch.parts.tail.object.material.uniforms.time.value, 456);
  assert.equal(batch.parts.tail.index.cells.size, 0, 'no spatial index rebuild in frame hot path');
  batch.updateFrame(new Map());
  assert.equal(batch.parts.tail.count, 0);
  assert.deepEqual(Array.from(batch.parts.marker.object.geometry.attributes.alpha.array.slice(0, 3)), [0, 0, 0]);
  batch.dispose();
});

test('sparse picking finds nearest forward sample, excludes hidden samples, and prunes distant points', () => {
  const count = 20000;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) positions.set([20 + index % 100, 20 + Math.floor(index / 100), 0], index * 3);
  positions.set([0, 0, 3], 0);
  positions.set([0, 0, 1], 3);
  positions.set([0, 0, 8], 6); // behind ray origin
  const index = new PointSpatialIndex();
  index.rebuild(positions, count);
  const ray = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  assert.equal(index.pick(ray, 0.08)?.index, 0);
  assert.equal(index.pick(ray, 0.08, (slot) => slot !== 0)?.index, 1);
  assert.ok(index.lastQueryPointTests < 20, `tested ${index.lastQueryPointTests} of ${count} points`);
  assert.equal(index.pick(new THREE.Ray(new THREE.Vector3(-10, -10, 5), new THREE.Vector3(0, 0, -1)), 0.08), null);
  index.dispose();
});

test('batch picking resolves authoritative orbit IDs and honors reference visibility', () => {
  const source = records(2, 1);
  source[0].reference = [{ positionKm: { x: 0, y: -12756.274, z: 0 } }];
  source[1].reference = [{ positionKm: { x: 0, y: 0, z: 0 } }];
  const batch = new OrbitBatchRenderer();
  batch.setRecords(source);
  const ray = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  assert.equal(batch.pick(ray)?.id, 'orbit-0');
  source[0].visible = false;
  batch.setRecords(source);
  assert.equal(batch.pick(ray)?.id, 'orbit-1');
  batch.parts.reference.object.visible = false;
  assert.equal(batch.pick(ray), null);
  batch.updateFrame(new Map([['orbit-1', { state: { positionKm: { x: 0, y: -6378.137, z: 0 } }, trail: [] }]]));
  assert.equal(batch.pick(ray)?.id, 'orbit-1');
  batch.dispose();
});

test('scene transitions at threshold without losing frames, selection, or reference visibility', () => {
  const source = records(ORBIT_BATCH_THRESHOLD);
  const scene = sceneHarness();
  scene.syncOrbits(source.slice(0, -1));
  assert.equal(scene.orbitBatch, undefined);
  scene.setComputedFrame({ elapsedSeconds: 20, records: [...frame(source).values()] });
  scene.setSelectedOrbits(['orbit-0', 'orbit-2']);
  scene.showReference = false;
  scene.syncOrbits(source);
  assert.ok(scene.orbitBatch);
  assert.equal(scene.root.children.length, 1, 'old per-orbit objects are removed');
  assert.equal(scene.orbitBatch.parts.reference.object.visible, false);
  assert.equal(scene.orbitBatch.styleTexture.image.data[3], 2);
  assert.equal(scene.orbitBatch.parts.marker.object.geometry.attributes.alpha.getX(0), 1);
  assert.equal(scene.getPerformanceStats().mode, 'batch');
  scene.syncOrbits(source.slice(0, -1));
  assert.equal(scene.orbitBatch, null);
  assert.equal(scene.orbitGroups.size, ORBIT_BATCH_THRESHOLD - 1);
  assert.equal(scene.orbitGroups.get('orbit-0').marker.visible, true);
  assert.equal(scene.orbitGroups.get('orbit-0').reference.visible, false);
  assert.equal(scene.orbitGroups.get('orbit-0').marker.scale.x, 1.24);
});

test('editing orbit elements invalidates stale computed frames in batch mode and when leaving it', () => {
  const source = records(ORBIT_BATCH_THRESHOLD);
  const scene = sceneHarness();
  scene.syncOrbits(source);
  scene.setComputedFrame({ records: [...frame(source).values()] });
  source[0].orbit.elements.inclinationDeg = 88;
  scene.syncOrbits(source);
  assert.equal(scene.computedRecords.has('orbit-0'), false);
  assert.equal(scene.orbitBatch.parts.marker.object.geometry.attributes.alpha.getX(0), 0);
  source[1].orbit.elements.inclinationDeg = 87;
  scene.syncOrbits(source.slice(0, -1));
  assert.equal(scene.computedRecords.has('orbit-1'), false);
  assert.equal(scene.orbitGroups.get('orbit-1').marker.visible, false);
});
