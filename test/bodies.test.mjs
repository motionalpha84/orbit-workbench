import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, bodyById, modelForBody, modelsForBody } from '../js/bodies.mjs';

test('J2 and J3 are offered for Earth only', () => {
  assert.deepEqual(modelsForBody('earth'), ['two-body', 'j2', 'j3']);
  for (const body of BODIES.filter((item) => item.id !== 'earth')) assert.deepEqual(body.models, ['two-body'], body.id);
});

test('switching body keeps the model when offered, otherwise falls back to two-body', () => {
  assert.equal(modelForBody('earth', 'j3'), 'j3');
  assert.equal(modelForBody('moon', 'j2'), 'two-body');
  assert.equal(modelForBody('mars', 'two-body'), 'two-body');
});

test('only bodies the backend computes are selectable, and unknown ids resolve to Earth', () => {
  assert.deepEqual(BODIES.filter((body) => body.available).map((body) => body.id), ['earth']);
  assert.equal(bodyById('pluto').id, 'earth');
});
