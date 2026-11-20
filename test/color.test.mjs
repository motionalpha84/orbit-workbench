import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ORBIT_COLORS,
  displayColorOnLight,
  hexToRgb,
  nextOrbitColor,
  normalizeHexColor,
  rgbToHex,
} from '../js/color.mjs';

test('uses the V2.2 Firefly default orbit color sequence', () => {
  assert.deepEqual(DEFAULT_ORBIT_COLORS, [
    '#2fb5a2',
    '#f07a3c',
    '#6a7fd8',
    '#94bc3a',
    '#d9a520',
    '#d2608a',
    '#3a92c8',
  ]);
  assert.equal(nextOrbitColor(0), '#2fb5a2');
  assert.equal(nextOrbitColor(7), '#2fb5a2');
});

test('pale orbit colours are darkened only for drawing on the light stage', () => {
  assert.equal(displayColorOnLight('#2fb5a2'), '#2fb5a2', 'mid-tone colours are unchanged');
  const shown = displayColorOnLight('#e2e8f0');
  assert.notEqual(shown, '#e2e8f0');
  const { r, g, b } = hexToRgb(shown);
  assert.ok((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.6, 'v2.1 near-white turns legible');
});

test('converts between RGB inputs and normalized hex colors', () => {
  assert.equal(rgbToHex(86, 140, 135), '#568c87');
  assert.deepEqual(hexToRgb('#568c87'), { r: 86, g: 140, b: 135 });
  assert.equal(normalizeHexColor('568C87'), '#568c87');
  assert.equal(normalizeHexColor('#xyz', '#616c8c'), '#616c8c');
});
