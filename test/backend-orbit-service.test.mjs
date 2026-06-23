import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/services/orbit-service.mjs';

const elements = {
  name: 'LEO-01',
  semiMajorAxisKm: 7000,
  eccentricity: 0,
  inclinationDeg: 0,
  raanDeg: 0,
  argPeriapsisDeg: 0,
  trueAnomalyDeg: 0,
};

test('creates an orbit record with metrics and initial state', () => {
  const record = createOrbitRecord({ id: 'orbit-1', color: '#568c87', elements });

  assert.equal(record.id, 'orbit-1');
  assert.equal(record.name, 'LEO-01');
  assert.equal(record.color, '#568c87');
  assert.equal(record.visible, true);
  assert.equal(record.orbit.elements.semiMajorAxisKm, 7000);
  assert.equal(record.metrics.periodSeconds, record.orbit.periodSeconds);
  assert.equal(record.metrics.initialPositionKm.x, 7000);
  assert.ok(record.metrics.speedRangeKmS.min > 7);
});

test('throws structured validation errors for invalid elements', () => {
  assert.throws(
    () => createOrbitRecord({
      elements: { ...elements, semiMajorAxisKm: 6378, eccentricity: 0.01 },
      color: '#568c87',
    }),
    (error) => error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
  );
});
