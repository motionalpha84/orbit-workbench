import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ORBIT_COLORS,
  hexToRgb,
  nextOrbitColor,
  normalizeHexColor,
  rgbToHex,
} from '../js/color.mjs';

test('uses the requested default orbit color sequence', () => {
  assert.deepEqual(DEFAULT_ORBIT_COLORS, [
    '#616c8c',
    '#568c87',
    '#7cb388',
    '#f2de79',
    '#d95f18',
  ]);
  assert.equal(nextOrbitColor(0), '#616c8c');
  assert.equal(nextOrbitColor(5), '#616c8c');
});

test('converts between RGB inputs and normalized hex colors', () => {
  assert.equal(rgbToHex(86, 140, 135), '#568c87');
  assert.deepEqual(hexToRgb('#568c87'), { r: 86, g: 140, b: 135 });
  assert.equal(normalizeHexColor('568C87'), '#568c87');
  assert.equal(normalizeHexColor('#xyz', '#616c8c'), '#616c8c');
});
