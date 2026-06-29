import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCalibrationMarkers,
  vectorToScene,
} from '../js/scene.mjs';

test('normalizes finite calibration marker data', () => {
  const markers = normalizeCalibrationMarkers([
    {
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
