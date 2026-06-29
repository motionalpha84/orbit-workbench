import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCalibrationMarkers,
  vectorToScene,
} from '../js/scene.mjs';

test('normalizes finite calibration marker data', () => {
  const markers = normalizeCalibrationMarkers([
    {
      targetId: 'target-1',
      targetName: '近地点速度',
      targetMode: 'velocity',
      orbitId: 'orbit-1',
      orbitName: 'Orbit 1',
      color: '#7fd1c7',
      positionKm: { x: 7000, y: 10, z: -20 },
      residual: 0.001,
      elapsedSeconds: 120,
    },
    {
      orbitId: 'bad',
      positionKm: { x: NaN, y: 0, z: 0 },
    },
  ]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].orbitId, 'orbit-1');
  assert.equal(markers[0].targetId, 'target-1');
  assert.equal(markers[0].targetName, '近地点速度');
  assert.equal(markers[0].targetMode, 'velocity');
  assert.deepEqual(markers[0].scenePosition, vectorToScene({ x: 7000, y: 10, z: -20 }));
});

test('normalizes missing marker labels and colors', () => {
  const markers = normalizeCalibrationMarkers([
    {
      orbitId: 'orbit-2',
      positionKm: { x: 1, y: 2, z: 3 },
    },
  ]);

  assert.equal(markers[0].orbitName, '未命名轨道');
  assert.equal(markers[0].color, '#8bbfba');
});

test('normalizes missing marker target labels', () => {
  const markers = normalizeCalibrationMarkers([
    {
      orbitId: 'orbit-3',
      positionKm: { x: 4, y: 5, z: 6 },
    },
  ]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].targetId, '');
  assert.equal(markers[0].targetName, '未命名标定');
  assert.equal(markers[0].targetMode, 'position');
});
