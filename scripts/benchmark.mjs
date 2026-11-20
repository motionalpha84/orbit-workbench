import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createWorkbenchServer } from '../server.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const count = Number(option('--count', '1000'));
const workers = Number(option('--workers', '2'));
assert.ok(Number.isInteger(count) && count > 0 && count <= 5000, '--count must be 1–5000');
assert.ok(Number.isInteger(workers) && workers > 0 && workers <= 16, '--workers must be 1–16');
const outputPath = option('--output', null);
const application = createWorkbenchServer({ workers });
await new Promise((done, reject) => {
  application.server.once('error', reject);
  application.server.listen(0, '127.0.0.1', done);
});
const base = `http://127.0.0.1:${application.server.address().port}`;
const records = Array.from({ length: count }, (_, index) => ({
  id: `benchmark-${index}`, name: `Orbit ${index + 1}`, color: '#82dfce', visible: true,
  elements: {
    semiMajorAxisKm: 6900 + (index % 240) * 45,
    eccentricity: 0.002 + (index % 31) * 0.001,
    inclinationDeg: (index * 37) % 180, raanDeg: (index * 137.5) % 360,
    argPeriapsisDeg: (index * 51.37) % 360, trueAnomalyDeg: (index * 9.17) % 360,
  },
}));
const healthProbes = [];
const phases = [];
let activePhase = 'startup';
let stopped = false;
let peakRssBytes = process.memoryUsage().rss;
const baselineMemory = process.memoryUsage();
const start = performance.now();

async function request(path, payload) {
  const response = await fetch(`${base}${path}`, {
    ...(payload ? { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } } : {}),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  const data = JSON.parse(text);
  assert.equal(response.ok, true, `${path}: ${text.slice(0, 300)}`);
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  return { data, bytes: Buffer.byteLength(text), status: response.status };
}

const healthLoop = (async () => {
  while (!stopped) {
    const phase = activePhase;
    const before = performance.now();
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      healthProbes.push({ phase, latencyMs: performance.now() - before, status: response.status, running: data.running, queued: data.queued });
    } catch (error) {
      healthProbes.push({ phase, latencyMs: performance.now() - before, error: error.message });
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    await sleep(25);
  }
})();

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : null,
    p95Ms: sorted.length ? sorted[Math.ceil((sorted.length - 1) * 0.95)] : null,
    maxMs: sorted.at(-1) ?? null,
  };
}

async function measureFrame(elapsedSeconds, groundTrack) {
  const label = groundTrack ? `frame-j3-map-${elapsedSeconds}s` : `frame-j3-${elapsedSeconds}s`;
  activePhase = label;
  const before = performance.now();
  const result = await request('/api/compute/frame', {
    records, elapsedSeconds, perturbationModel: 'j3', trailCount: 32,
    ...(groundTrack ? { groundTrack } : {}),
  });
  assert.equal(result.data.records.length, count);
  assert.equal(result.data.elapsedSeconds, elapsedSeconds);
  assert.ok(result.data.records.every((record) => ['x', 'y', 'z'].every((axis) => Number.isFinite(record.state.positionKm[axis]))));
  assert.ok(result.data.records.every((record) => record.trail.length === result.data.trailCount));
  phases.push({
    name: label, elapsedMs: performance.now() - before, resultBytes: result.bytes,
    trailPoints: result.data.records.reduce((total, record) => total + record.trail.length, 0),
    trackCount: result.data.tracks?.length ?? 0,
    trackPoints: result.data.tracks?.reduce((total, track) => total + track.points.length, 0) ?? 0,
  });
}

try {
  await request('/api/health');
  activePhase = 'prepare-j3';
  const before = performance.now();
  const created = await request('/api/jobs', { type: 'prepare', payload: { records, perturbationModel: 'j3', referenceSampleCount: 3600 } });
  assert.equal(created.status, 202);
  let job = created.data;
  while (job.status !== 'completed') {
    assert.ok(!['failed', 'cancelled'].includes(job.status), JSON.stringify(job));
    await sleep(25);
    job = (await request(`/api/jobs/${job.id}`)).data;
  }
  {
    const prepared = await request(`/api/jobs/${job.id}/result`);
    assert.equal(prepared.data.records.length, count);
    const referencePoints = prepared.data.records.reduce((total, record) => total + record.reference.length, 0);
    assert.ok(referencePoints <= prepared.data.referencePointBudget);
    phases.push({ name: 'prepare-j3', elapsedMs: performance.now() - before, workerDurationMs: job.durationMs, resultBytes: prepared.bytes, referencePoints });
  }
  for (const time of [0, 60, 120, 600, 3600]) await measureFrame(time);
  const groundTrack = {
    sessionId: 'benchmark-ground', resetToken: 'initial', activeIds: records.slice(0, 48).map((record) => record.id),
    startUtcMs: Date.parse('2026-10-13T00:00:00Z'), referenceSampleCount: 3600,
    window: { mode: 'revs', pastRevs: 2 }, maxCatchUpPoints: 250,
  };
  await measureFrame(0, groundTrack);
  await measureFrame(600, groundTrack);
  stopped = true;
  await healthLoop;
  const finalHealth = (await request('/api/health')).data;
  assert.ok(healthProbes.every((probe) => probe.status === 200), 'health endpoints must remain available during worker calculations');
  const framePhases = phases.filter((phase) => phase.name.startsWith('frame-j3-') && !phase.name.includes('-map-'));
  const result = {
    measuredAtUtc: new Date().toISOString(), command: `node scripts/benchmark.mjs --count ${count} --workers ${workers}`,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
    workload: { records: count, workers, model: 'j3', requestedReferenceSamples: 3600, frameTrailCount: 32, groundTracks: Math.min(48, count) },
    totalElapsedMs: performance.now() - start,
    phases,
    frames: summary(framePhases.map((phase) => phase.elapsedMs)),
    healthDuringWork: summary(healthProbes.filter((probe) => probe.running > 0).map((probe) => probe.latencyMs)),
    healthOverall: summary(healthProbes.map((probe) => probe.latencyMs)),
    healthErrors: healthProbes.filter((probe) => probe.status !== 200),
    memory: { baselineRssBytes: baselineMemory.rss, peakObservedRssBytes: peakRssBytes, finalRssBytes: process.memoryUsage().rss, mainThreadHeapUsedBytes: process.memoryUsage().heapUsed },
    finalHealth,
    notes: ['Single local run, includes HTTP JSON encoding/decoding and test client in same Node process.', 'RSS includes workers and benchmark client; heapUsed covers main thread only.', 'Health probes run every 25 ms plus request duration; this does not measure browser FPS or guarantee frame rates.'],
  };
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  stopped = true;
  await healthLoop;
  await application.close();
}
