import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbitRecord } from '../backend/services/orbit-service.mjs';
import {
  createGroundTrackCsv,
  createGroundTrackRegionStats,
  createGroundTrackRenderData,
} from '../backend/services/groundtrack-service.mjs';

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

test('creates ground-track render data', () => {
  const data = createGroundTrackRenderData({
    orbits: [orbitRecord()],
    elapsedSeconds: 600,
    startUtcMs: Date.UTC(2026, 0, 1),
    perturbationModel: 'j3',
    window: { mode: 'revs', pastRevs: 1 },
    performance: { mode: 'power-save', memoryGb: 4 },
  });

  assert.equal(data.version, 1);
  assert.equal(data.tracks.length, 1);
  assert.equal(data.tracks[0].id, 'orbit-1');
  assert.ok(data.tracks[0].points.length > 0);
  assert.ok(data.tracks[0].segments.length > 0);
  assert.equal(data.tracks[0].current.perturbationModel, 'j3');
});

test('starts backend ground tracks at the current simulation time without backfilling', () => {
  const data = createGroundTrackRenderData({
    historyKey: 'history-starts-current',
    orbits: [orbitRecord()],
    elapsedSeconds: 1200,
    startUtcMs: Date.UTC(2026, 0, 1),
    perturbationModel: 'two-body',
    window: { mode: 'revs', pastRevs: 2 },
    performance: { mode: 'high', memoryGb: 8 },
  });
  const track = data.tracks[0];

  assert.equal(track.pastSegments.length, 0);
  assert.equal(track.currentSegments.length, 1);
  assert.deepEqual(track.points.map((point) => point.elapsedSeconds), [1200]);
});

test('keeps backend ground-track history scoped by history key', () => {
  const record = orbitRecord();
  createGroundTrackRenderData({
    historyKey: 'history-scope-a',
    orbits: [record],
    elapsedSeconds: 0,
    startUtcMs: Date.UTC(2026, 0, 1),
    window: { mode: 'revs', pastRevs: 2 },
  });
  const accumulated = createGroundTrackRenderData({
    historyKey: 'history-scope-a',
    orbits: [record],
    elapsedSeconds: 50000,
    startUtcMs: Date.UTC(2026, 0, 1),
    window: { mode: 'revs', pastRevs: 2 },
    performance: { mode: 'high', memoryGb: 8 },
  });
  const reset = createGroundTrackRenderData({
    historyKey: 'history-scope-b',
    orbits: [record],
    elapsedSeconds: 50000,
    startUtcMs: Date.UTC(2026, 0, 1),
    window: { mode: 'revs', pastRevs: 2 },
    performance: { mode: 'high', memoryGb: 8 },
  });

  assert.ok(accumulated.tracks[0].points.length > 1);
  assert.deepEqual(reset.tracks[0].points.map((point) => point.elapsedSeconds), [50000]);
});

test('creates region stats and CSV from tracks', () => {
  const data = createGroundTrackRenderData({ orbits: [orbitRecord()] });
  const stats = createGroundTrackRegionStats({
    tracks: data.tracks,
    bounds: { westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90 },
  });
  const csv = createGroundTrackCsv({ tracks: data.tracks });

  assert.equal(stats.totalOrbitCount, 1);
  assert.match(csv, /轨道名称,轨道 ID,仿真秒,UTC 时间,经度,纬度,动力学模型/);
  assert.match(csv, /LEO-01/);
});
