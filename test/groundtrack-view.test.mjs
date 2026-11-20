import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GroundTrackView,
  lonLatToMapPoint,
  mapPointToLonLat,
  normalizeMapViewport,
  selectionToLonLatBounds,
} from '../js/groundtrack-view.mjs';

test('unchanged map panel and fullscreen states do not redraw the map', () => {
  const view = new GroundTrackView();
  let draws = 0;
  view.draw = () => { draws += 1; };
  view.setPanelOpen(false);
  view.setFullscreen(false);
  assert.equal(draws, 0);
  view.setPanelOpen(true);
  assert.equal(draws, 1);
  for (let index = 0; index < 60; index += 1) {
    view.setPanelOpen(true);
    view.setFullscreen(false);
  }
  assert.equal(draws, 1);
  view.setFullscreen(true);
  assert.equal(draws, 2);
  view.setPanelOpen(false);
  view.setFullscreen(false);
  assert.equal(draws, 2);
});

test('map draws only changed snapshots and stores hidden snapshots for reopening', () => {
  const view = new GroundTrackView();
  let draws = 0;
  view.draw = () => { draws += 1; };
  const track = { id: 'one', points: [] };
  view.setData([track], { selectedIds: ['one'], elapsedSeconds: 20 });
  assert.equal(draws, 0);
  assert.deepEqual(view.tracks, [track]);
  view.setPanelOpen(true);
  assert.equal(draws, 1);
  view.setData([track], { selectedIds: ['one', 'one'], elapsedSeconds: 20 });
  view.setOptions({ highlightEquator: true });
  assert.equal(draws, 1, 'repeated presentation state must not redraw unchanged data');
  view.setData([track], { selectedIds: [], elapsedSeconds: 20 });
  assert.equal(draws, 2, 'selection changes redraw');
  view.setData([{ ...track }], { selectedIds: [], elapsedSeconds: 21 });
  assert.equal(draws, 3, 'new backend snapshots redraw');
  view.setOptions({ highlightEquator: false });
  assert.equal(draws, 4);
});

const nearlyEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
};

test('formats UTC display without ISO separators or milliseconds', async () => {
  const viewModule = await import('../js/groundtrack-view.mjs');

  assert.equal(typeof viewModule.formatUtc, 'function');
  assert.equal(viewModule.formatUtc(Date.parse('2026-06-21T02:41:51.414Z')), '2026-06-21   02:41:51');
});

test('projects longitude and latitude to equirectangular map coordinates', () => {
  assert.deepEqual(lonLatToMapPoint(0, 0, 360, 180), { x: 180, y: 90 });
  assert.deepEqual(lonLatToMapPoint(-180, 90, 360, 180), { x: 0, y: 0 });
  assert.deepEqual(lonLatToMapPoint(180, -90, 360, 180), { x: 360, y: 180 });
});

test('inverts equirectangular map coordinates into longitude and latitude', () => {
  const center = mapPointToLonLat(180, 90, 360, 180);
  nearlyEqual(center.longitudeDeg, 0, 1e-12, 'center longitude');
  nearlyEqual(center.latitudeDeg, 0, 1e-12, 'center latitude');

  const corner = mapPointToLonLat(0, 0, 360, 180);
  nearlyEqual(corner.longitudeDeg, -180, 1e-12, 'corner longitude');
  nearlyEqual(corner.latitudeDeg, 90, 1e-12, 'corner latitude');
});

test('keeps normalized viewport zoom and pan within useful map bounds', () => {
  const viewport = normalizeMapViewport({
    scale: 24,
    offsetX: 100000,
    offsetY: -100000,
  }, 800, 400);

  assert.equal(viewport.scale, 18);
  assert.ok(viewport.offsetX <= 0, 'x offset should not leave blank space on the left');
  assert.ok(viewport.offsetY <= 0, 'y offset should not leave blank space above');
  assert.ok(viewport.offsetX + 800 * viewport.scale >= 800, 'x offset should cover the viewport width');
  assert.ok(viewport.offsetY + 400 * viewport.scale >= 400, 'y offset should cover the viewport height');
});

test('allows small canvases and hidden panels to normalize without NaN values', () => {
  const viewport = normalizeMapViewport({ scale: 0, offsetX: Number.NaN, offsetY: Infinity }, 0, 0);

  assert.equal(viewport.scale, 1);
  assert.equal(viewport.offsetX, 0);
  assert.equal(viewport.offsetY, 0);
});

test('converts a screen selection rectangle to lon-lat bounds', () => {
  const bounds = selectionToLonLatBounds(
    { startX: 200, startY: 100, endX: 600, endY: 300 },
    { scale: 1, offsetX: 0, offsetY: 0 },
    800,
    400,
  );

  nearlyEqual(bounds.westDeg, -90, 1e-12, 'west');
  nearlyEqual(bounds.eastDeg, 90, 1e-12, 'east');
  nearlyEqual(bounds.southDeg, -45, 1e-12, 'south');
  nearlyEqual(bounds.northDeg, 45, 1e-12, 'north');
});
