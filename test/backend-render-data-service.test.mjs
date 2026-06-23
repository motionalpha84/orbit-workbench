import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/services/orbit-service.mjs';
import { createSceneRenderData } from '../backend/services/render-data-service.mjs';

function orbitRecord() {
  return createOrbitRecord({
    id: 'orbit-1',
    color: '#568c87',
    elements: {
      name: 'LEO-01',
      semiMajorAxisKm: 7000,
      eccentricity: 0.001,
      inclinationDeg: 51.6,
      raanDeg: 40,
      argPeriapsisDeg: 30,
      trueAnomalyDeg: 0,
    },
  });
}

test('creates 3D render data for visible orbits', () => {
  const data = createSceneRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 120,
    perturbationModel: 'j2',
    frame: 'ECEF',
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.equal(data.version, 1);
  assert.equal(data.elapsedSeconds, 120);
  assert.equal(data.frame, 'ECEF');
  assert.equal(data.perturbationModel, 'j2');
  assert.equal(data.orbits.length, 1);
  assert.equal(data.orbits[0].id, 'orbit-1');
  assert.ok(data.orbits[0].periodSeconds > 0);
  assert.ok(data.orbits[0].referencePoints.length >= 180);
  assert.ok(data.orbits[0].playbackSamples.length >= 180);
  assert.equal(data.orbits[0].tailSamples.length, 130);
  assert.equal(typeof data.orbits[0].current.positionKm.x, 'number');
});

test('performance mode bounds scene sample counts', () => {
  const data = createSceneRenderData({
    orbits: [orbitRecord()],
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.ok(data.orbits[0].referencePoints.length <= 900);
  assert.ok(data.orbits[0].playbackSamples.length <= 900);
});
