import test from 'node:test';
import assert from 'node:assert/strict';

import { parseElementGroupText, parseTrajectoryText } from '../js/importers.mjs';
import { smoothTrajectory, trajectoryFrames, trajectoryPositionAt } from '../js/trajectory.mjs';
import { greenwichSiderealAngleAt } from '../js/groundtrack.mjs';

const MU = 398600.4418;

// a circular equatorial orbit sampled every `step` seconds, optionally with velocities
function circle(radius, step, count, withVelocity) {
  const n = Math.sqrt(MU / radius ** 3);
  return Array.from({ length: count }, (_, k) => {
    const t = k * step; const a = n * t;
    const line = [t, radius * Math.cos(a), radius * Math.sin(a), 0];
    if (withVelocity) line.push(-radius * n * Math.sin(a), radius * n * Math.cos(a), 0);
    return line.join(' ');
  }).join('\n');
}

test('element group TXT reads one orbit per line with a group name and an optional header', () => {
  const group = parseElementGroupText(`
# GROUP: 轨道组001
name  a  e  i  RAAN  AOP  TA
SSO-01   7078.137  0.001  98.19  100  90  0
SSO 02,7078.137,0.001,98.19,100,90
`);
  assert.equal(group.groupName, '轨道组001');
  assert.equal(group.records.length, 2);
  assert.deepEqual(group.records[0], { name: 'SSO-01', semiMajorAxisKm: 7078.137, eccentricity: 0.001, inclinationDeg: 98.19, raanDeg: 100, argPeriapsisDeg: 90, trueAnomalyDeg: 0 });
  assert.equal(group.records[1].name, 'SSO 02', 'comma-separated names may contain spaces');
  assert.equal(group.records[1].trueAnomalyDeg, 0, 'a missing ν defaults to 0');
});

test('orbit elements TXT reads one orbit per line and still accepts the legacy layout', async () => {
  const { parseOrbitText } = await import('../js/importers.mjs');
  const lines = parseOrbitText('# name a e i RAAN AOP TA\nLEO-01 8000 0.001 51.6 40 30 0\nPOLAR 7200,0.01,97,10,0\n'.replace('POLAR 7200,', 'POLAR,7200,'));
  assert.deepEqual(lines.map((r) => r.name), ['LEO-01', 'POLAR']);
  assert.equal(lines[1].trueAnomalyDeg, 0);
  const legacy = parseOrbitText('Solution 1\n7000\n0.001\n51.6\n40\n30\n5\n');
  assert.equal(legacy[0].name, 'Solution 1');
  assert.equal(legacy[0].trueAnomalyDeg, 5);
  assert.throws(() => parseOrbitText('LEO-01 8000 0.001 51.6 40 30 0\nBAD 1 2'), /第 2 行应为「名称 a e i Ω ω ν」/);
  assert.throws(() => parseOrbitText('# only a comment'), /TXT 文件为空/);
  const { parseOrbitFile } = await import('../js/importers.mjs');
  assert.equal(parseOrbitFile('# GROUP: 轨道组007\nLEO-01 8000 0.001 51.6 40 30 0').groupName, '轨道组007');
  assert.equal(parseOrbitFile('# GROUP = 旧版组\nSolution 1\n7000\n0.001\n51.6\n40\n30\n').groupName, '旧版组', 'the legacy layout reads # GROUP too');
  assert.equal(parseOrbitFile('LEO-01 8000 0.001 51.6 40 30 0').groupName, '');
});

test('element group TXT reports the offending line and column', () => {
  assert.throws(() => parseElementGroupText('A 7000 0.001 51.6 40'), /第 1 行应为「名称 a e i Ω ω ν」/);
  assert.throws(() => parseElementGroupText('A 7000 0.001 x 40 30 0'), /第 1 行第 4 列（i）不是有效数值/);
  assert.throws(() => parseElementGroupText('# only comments'), /没有轨道数据/);
});

test('trajectory TXT supports several named blocks, UTC stamps and optional velocities', () => {
  const trajectories = parseTrajectoryText(`
# NAME: TRJ-A
t x y z
0    7000 0 0
60   6990 300 10
120  6960 600 20
# NAME: TRJ-B
2026-10-23T06:00:00Z 7000 0 0 0 7.5 0
2026-10-23 06:01:00  6990 450 0 -0.1 7.5 0
`);
  assert.equal(trajectories.length, 2);
  const [a, b] = trajectories;
  assert.equal(a.name, 'TRJ-A');
  assert.deepEqual(a.timeOrigin, { kind: 'elapsed', elapsedSeconds: 0 });
  assert.equal(a.hasVelocity, false);
  assert.deepEqual(a.samples.map((s) => s.t), [0, 60, 120]);
  assert.equal(b.timeOrigin.kind, 'utc');
  assert.equal(b.timeOrigin.utcMs, Date.UTC(2026, 9, 23, 6), 'zone-less stamps read as UTC');
  assert.equal(b.samples[1].t, 60);
  assert.deepEqual(b.samples[1].velocityKmS, { x: -0.1, y: 7.5, z: 0 });
});

test('trajectory TXT rejects unordered, mixed or short input', () => {
  assert.throws(() => parseTrajectoryText('0 7000 0 0\n0 7000 1 0'), /第 2 行的时间未严格递增/);
  assert.throws(() => parseTrajectoryText('0 7000 0 0\n2026-10-23T06:00:00Z 7000 1 0'), /时间格式与前文不一致/);
  assert.throws(() => parseTrajectoryText('0 7000 0 0 1 2 3\n60 7000 1 0'), /列数与前文不一致/);
  assert.throws(() => parseTrajectoryText('0 7000 0 0'), /至少需要 2 个时刻/);
  assert.throws(() => parseTrajectoryText('yesterday 7000 0 0\n1 1 1 1'), /应为秒数或 ISO 8601 UTC 时间/);
});

test('smoothing passes through every sample and stays on a circular orbit between sparse samples', () => {
  for (const withVelocity of [false, true]) {
    const [trajectory] = parseTrajectoryText(circle(7000, 300, 12, withVelocity));
    const dense = smoothTrajectory(trajectory.samples);
    assert.ok(dense.length > trajectory.samples.length * 10, 'sparse 300 s samples gain intermediate points');
    for (const sample of trajectory.samples) {
      const hit = dense.find((point) => point.t === sample.t);
      assert.ok(hit, `sample t=${sample.t} kept`);
      assert.deepEqual(hit.p, [sample.positionKm.x, sample.positionKm.y, sample.positionKm.z]);
    }
    // ~18.5° between samples: the interpolated radius stays close to 7000 km
    const worst = Math.max(...dense.map(({ p }) => Math.abs(Math.hypot(...p) - 7000)));
    assert.ok(worst < (withVelocity ? 0.5 : 10), `${withVelocity ? 'Hermite' : 'Catmull-Rom'} radius error ${worst.toFixed(2)} km`);
  }
});

test('smoothing respects the point budget', () => {
  const [trajectory] = parseTrajectoryText(circle(7000, 900, 200, false));
  assert.ok(smoothTrajectory(trajectory.samples, { maxPoints: 1000 }).length <= 1000);
});

test('frames rotate by the sidereal angle at each sample and interpolate by time', () => {
  const epochMs = Date.UTC(2026, 9, 23, 6);
  const [parsed] = parseTrajectoryText('0 7000 0 0\n3600 0 7000 0');
  const trajectory = { frame: 'ECEF', timeOrigin: parsed.timeOrigin, dense: smoothTrajectory(parsed.samples) };
  const { elapsed, eci, ecef } = trajectoryFrames(trajectory, epochMs);
  const theta = greenwichSiderealAngleAt(epochMs, 3600);
  const last = eci[eci.length - 1];
  assert.ok(Math.abs(last[0] + 7000 * Math.sin(theta)) < 1e-6 && Math.abs(last[1] - 7000 * Math.cos(theta)) < 1e-6);
  assert.deepEqual(ecef[0], [7000, 0, 0], 'the source frame is kept as-is');
  assert.equal(trajectoryPositionAt(elapsed, ecef, -1), null);
  assert.equal(trajectoryPositionAt(elapsed, ecef, 4000), null);
  assert.deepEqual(trajectoryPositionAt(elapsed, ecef, 0), [7000, 0, 0]);
});

test('every import example in Help parses with its importer', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseOrbitFile, parseOrbitText } = await import('../js/importers.mjs');
  const html = (await readFile('index.html', 'utf8')).replace(/\r\n/g, '\n');
  const example = (id) => /<pre class="hf-code"[^>]*>([\s\S]*?)<\/pre>/.exec(html.slice(html.indexOf(`id="${id}"`)))[1];
  const workspace = JSON.parse(example('hf-workspace'));
  assert.equal(workspace.snapshot.orbits.length, 1);
  assert.equal(parseOrbitText(example('hf-elements')).length, 3);
  assert.equal(parseOrbitFile(example('hf-elements')).groupName, '轨道组001');
  const group = parseElementGroupText(example('hf-group'));
  assert.equal(group.groupName, '轨道组001');
  assert.equal(group.records.length, 3);
  const [trajectory] = parseTrajectoryText(example('hf-trajectory'));
  assert.equal(trajectory.name, 'TRJ-01');
  assert.equal(trajectory.samples.length, 5);
  // the example is a real 7000 km circular orbit
  for (const { positionKm } of trajectory.samples) assert.ok(Math.abs(Math.hypot(positionKm.x, positionKm.y, positionKm.z) - 7000) < 0.01);
});
