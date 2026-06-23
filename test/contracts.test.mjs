import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_VERSION,
  DEFAULT_GROUND_TRACK_WINDOW,
  DEFAULT_PERFORMANCE_OPTIONS,
  SUPPORTED_FRAMES,
  SUPPORTED_PERFORMANCE_MODES,
  SUPPORTED_PERTURBATION_MODELS,
  SUPPORTED_TIME_UNITS,
  apiError,
  apiOk,
  normalizeFrame,
  normalizeGroundTrackWindow,
  normalizePerformanceOptions,
  normalizePerturbationModelValue,
} from '../shared/contracts.mjs';

test('exports stable API constants', () => {
  assert.equal(API_VERSION, 1);
  assert.deepEqual(SUPPORTED_PERTURBATION_MODELS, ['two-body', 'j2', 'j3']);
  assert.deepEqual(SUPPORTED_PERFORMANCE_MODES, ['power-save', 'balanced', 'high', 'custom']);
  assert.deepEqual(SUPPORTED_FRAMES, ['ECI', 'ECEF']);
  assert.deepEqual(SUPPORTED_TIME_UNITS, ['s', 'min', 'hr', 'day']);
  assert.deepEqual(DEFAULT_PERFORMANCE_OPTIONS, {
    mode: 'balanced',
    memoryGb: 4,
  });
  assert.deepEqual(DEFAULT_GROUND_TRACK_WINDOW, {
    mode: 'revs',
    pastRevs: 2,
    pastSeconds: 3600,
    timeUnit: 'min',
  });
});

test('wraps success and error responses consistently', () => {
  assert.deepEqual(apiOk({ value: 42 }), {
    ok: true,
    data: { value: 42 },
  });
  assert.deepEqual(apiError('VALIDATION_ERROR', 'Bad orbit', { field: 'eccentricity' }), {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Bad orbit',
      details: { field: 'eccentricity' },
    },
  });
});

test('normalizes request option values', () => {
  assert.equal(normalizePerturbationModelValue('j2'), 'j2');
  assert.equal(normalizePerturbationModelValue('bad'), 'two-body');
  assert.equal(normalizeFrame('ECEF'), 'ECEF');
  assert.equal(normalizeFrame('bad'), 'ECI');
  assert.deepEqual(normalizePerformanceOptions({ mode: 'custom', memoryGb: 16 }), {
    mode: 'custom',
    memoryGb: 16,
  });
  assert.deepEqual(normalizePerformanceOptions({ mode: 'bad', memoryGb: -3 }), {
    mode: 'balanced',
    memoryGb: 4,
  });
  assert.deepEqual(normalizePerformanceOptions({ mode: 'custom', memoryGb: 0.5 }), {
    mode: 'custom',
    memoryGb: 1,
  });
  assert.deepEqual(normalizePerformanceOptions({ mode: 'custom', memoryGb: 32 }), {
    mode: 'custom',
    memoryGb: 24,
  });
});

test('normalizes null and non-object request option containers', () => {
  assert.deepEqual(normalizePerformanceOptions(null), {
    mode: 'balanced',
    memoryGb: 4,
  });
  assert.deepEqual(normalizePerformanceOptions('bad'), {
    mode: 'balanced',
    memoryGb: 4,
  });
  assert.deepEqual(normalizeGroundTrackWindow(null), DEFAULT_GROUND_TRACK_WINDOW);
  assert.deepEqual(normalizeGroundTrackWindow('bad'), DEFAULT_GROUND_TRACK_WINDOW);
});

test('exports immutable API constants', () => {
  assert.equal(Object.isFrozen(SUPPORTED_PERTURBATION_MODELS), true);
  assert.equal(Object.isFrozen(SUPPORTED_PERFORMANCE_MODES), true);
  assert.equal(Object.isFrozen(SUPPORTED_FRAMES), true);
  assert.equal(Object.isFrozen(SUPPORTED_TIME_UNITS), true);
  assert.equal(Object.isFrozen(DEFAULT_PERFORMANCE_OPTIONS), true);
  assert.equal(Object.isFrozen(DEFAULT_GROUND_TRACK_WINDOW), true);
});

test('normalizes ground-track windows', () => {
  assert.deepEqual(
    normalizeGroundTrackWindow({ mode: 'time', pastSeconds: 120, timeUnit: 's' }),
    { mode: 'time', pastRevs: 2, pastSeconds: 120, timeUnit: 's' },
  );
  assert.deepEqual(
    normalizeGroundTrackWindow({ mode: 'revs', pastRevs: 8, pastSeconds: -1, timeUnit: 'bad' }),
    { mode: 'revs', pastRevs: 8, pastSeconds: 3600, timeUnit: 'min' },
  );
});
