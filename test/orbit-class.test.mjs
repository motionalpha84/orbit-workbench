import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrbit, classifyOrbitRecord, ORBIT_CLASSES } from '../js/orbit-class.mjs';

const MU = 398600.4418;
const period = (a) => 2 * Math.PI * Math.sqrt(a ** 3 / MU);
const cls = (a, e, i) => classifyOrbit({ semiMajorAxisKm: a, eccentricity: e, inclinationDeg: i, periodSeconds: period(a) });

test('approved V2.2 rule table classifies the reference orbits', () => {
  assert.equal(cls(7000, 0.001, 51.6), 'LEO');
  assert.equal(cls(7178, 0.0012, 98.2), 'LEO');
  assert.equal(cls(10800, 0.25, 27), 'HEO');
  assert.equal(cls(26560, 0.72, 63.4), 'Molniya');
  assert.equal(cls(26560, 0.005, 55), 'MEO');
  assert.equal(cls(42164, 0.003, 55), 'IGSO');
  assert.equal(cls(42164, 0.0002, 0.05), 'GEO');
});

test('class boundaries follow the agreed thresholds', () => {
  assert.equal(cls(42364, 0.001, 1), 'GEO', '+200 km stays in the GEO band');
  assert.equal(cls(42365, 0.001, 1), 'MEO', 'just outside the band is no longer GEO');
  assert.equal(cls(42164, 0.01, 1), 'MEO', 'e must be < 0.01 for GEO');
  assert.equal(cls(42164, 0.001, 5), 'IGSO', 'i ≥ 5° in the GEO band is IGSO');
  assert.equal(cls(26560, 0.72, 67), 'HEO', 'Molniya needs i within 63.4 ± 3°');
  assert.equal(cls(8000, 0.2, 10), 'MEO', 'apogee at 3222 km is above the LEO ceiling');
  assert.equal(classifyOrbit({ semiMajorAxisKm: 26560, eccentricity: 0.72, inclinationDeg: 63.4 }), 'HEO', 'Molniya needs a known period');
  assert.equal(classifyOrbit({ semiMajorAxisKm: 'x', eccentricity: 0, inclinationDeg: 0 }), null);
});

test('records classify through their prepared orbit and every class has an accent', () => {
  const record = { orbit: { elements: { semiMajorAxisKm: 42164, eccentricity: 0, inclinationDeg: 0 }, periodSeconds: 86164 } };
  assert.equal(classifyOrbitRecord(record), 'GEO');
  assert.equal(classifyOrbitRecord({}), null);
  for (const meta of Object.values(ORBIT_CLASSES)) assert.match(meta.accent, /^#[0-9A-F]{6}$/i);
});
