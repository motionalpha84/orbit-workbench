import test from 'node:test';
import assert from 'node:assert/strict';
import { SchematicScene, schematicRadius, sunDirectionEci } from '../js/schematic-scene.mjs';
import { greenwichSiderealAngleAt } from '../js/groundtrack.mjs';

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

// the camera's view vector, as setupProjection builds it from yaw / pitch
const viewVector = ({ yaw, pitch }) => [-Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
const planeNormal = (iDeg, raanDeg) => {
  const i = iDeg * Math.PI / 180; const raan = raanDeg * Math.PI / 180;
  return [Math.sin(i) * Math.sin(raan), -Math.sin(i) * Math.cos(raan), Math.cos(i)];
};
const near = (a, b, eps = 1e-6) => a.every((v, k) => Math.abs(v - b[k]) < eps);

test('plane view looks straight down the orbit-plane normal and keeps the zoom', () => {
  const scene = new SchematicScene(null, { mini: true });
  for (const [i, raan] of [[51.6, 120], [98.2, -35], [63.4, 270], [135, 10]]) {
    const zoom = scene.camTarget.zoom;
    scene.setPlaneView(i, raan);
    assert.ok(near(viewVector(scene.camTarget), planeNormal(i, raan)), `i=${i} Ω=${raan}`);
    assert.equal(scene.camTarget.zoom, zoom);
  }
  // equatorial planes clamp just short of the poles, like the top view
  scene.setPlaneView(0, 0);
  assert.ok(near(viewVector(scene.camTarget), [0, 0, 1], 1e-3));
  scene.setPlaneView(180, 0);
  assert.ok(near(viewVector(scene.camTarget), [0, 0, -1], 1e-3));
});

test('plane view in ECEF follows the plane as drawn at the current Earth rotation', () => {
  const scene = new SchematicScene(null, { mini: true });
  scene.setEpoch(Date.UTC(2026, 9, 23, 6));
  scene.data.elapsed = 1800;
  scene.setFrame('ECEF');
  scene.setPlaneView(51.6, 120);
  const theta = greenwichSiderealAngleAt(scene.data.epochMs, scene.data.elapsed) * 180 / Math.PI;
  assert.ok(near(viewVector(scene.camTarget), planeNormal(51.6, 120 - theta)));
});
