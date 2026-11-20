import test from 'node:test';
import assert from 'node:assert/strict';
import { schematicRadius, sunDirectionEci } from '../js/schematic-scene.mjs';

test('schematic radial scale maps the surface to 1 and keeps GEO on screen', () => {
  assert.equal(schematicRadius(6378.137), 1);
  const leo = schematicRadius(7000);
  const geo = schematicRadius(42164);
  assert.ok(leo > 1 && leo < 1.4, `LEO ${leo}`);
  assert.ok(geo > 3 && geo < 3.6, `GEO ${geo}`);
  assert.ok(schematicRadius(26560) < geo && schematicRadius(26560) > leo, 'monotonic between LEO and GEO');
});

test('solar direction is a unit vector that follows the seasons', () => {
  const march = sunDirectionEci(Date.UTC(2026, 2, 20, 12));
  const june = sunDirectionEci(Date.UTC(2026, 5, 21, 12));
  const december = sunDirectionEci(Date.UTC(2026, 11, 21, 12));
  for (const v of [march, june, december]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
  assert.ok(march[0] > 0.99, 'vernal equinox: sun near +X');
  assert.ok(Math.asin(june[2]) * 180 / Math.PI > 23, 'June solstice: declination ≈ +23.4°');
  assert.ok(Math.asin(december[2]) * 180 / Math.PI < -23, 'December solstice: declination ≈ −23.4°');
});
