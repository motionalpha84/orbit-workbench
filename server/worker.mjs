import { parentPort } from 'node:worker_threads';
import { computeOrbit, propagateOrbit, sampleOrbit, EARTH_RADIUS_KM } from '../js/orbit.mjs';
import { calibrateOrbitVectorTargets } from '../js/vector-calibration.mjs';
import { updateGroundTrackHistory, groundTrackTrackFromHistory } from '../js/groundtrack-history.mjs';
import { API_LIMITS } from './validation.mjs';
import { encodeFrame } from '../js/frame-codec.mjs';

const orbitCache = new Map();
const sessions = new Map();
const MAX_SESSIONS = 8;
const datasets = new Map();
const references = new Map();
let datasetRecords = 0;
let referencePoints = 0;
let cacheStats = { datasetHits: 0, referenceHits: 0, referenceMisses: 0 };

function recordsFor(payload, check) {
  const key = payload.datasetKey;
  const cached = key && datasets.get(key);
  if (cached) {
    datasets.delete(key); datasets.set(key, cached);
    cacheStats.datasetHits += 1;
    return cached;
  }
  const records = payload.records.map(record => { check(); return preparedRecord(record); });
  if (key) {
    while (datasets.size >= 16 || datasetRecords + records.length > API_LIMITS.records * 2) {
      const oldest = datasets.keys().next().value;
      datasetRecords -= datasets.get(oldest).length;
      datasets.delete(oldest);
    }
    datasets.set(key, records); datasetRecords += records.length;
  }
  return records;
}

function referenceFor(record, count, modelOptions) {
  const key = JSON.stringify([record.elements, count, modelOptions.perturbationModel]);
  const cached = references.get(key);
  if (cached) {
    references.delete(key); references.set(key, cached);
    cacheStats.referenceHits += 1;
    return cached;
  }
  cacheStats.referenceMisses += 1;
  const reference = sampleOrbit(record.orbit, count, modelOptions)
    .map(({ positionKm, elapsedSeconds }) => ({ positionKm, elapsedSeconds }));
  while (references.size && (referencePoints + reference.length > API_LIMITS.referencePoints || references.size >= API_LIMITS.records)) {
    const oldest = references.keys().next().value;
    referencePoints -= references.get(oldest).length;
    references.delete(oldest);
  }
  references.set(key, reference); referencePoints += reference.length;
  return reference;
}

function preparedRecord(record) {
  const key = JSON.stringify(record.elements);
  let orbit = orbitCache.get(key);
  if (!orbit) {
    orbit = computeOrbit(record.elements);
    orbitCache.set(key, orbit);
    if (orbitCache.size > API_LIMITS.records) orbitCache.delete(orbitCache.keys().next().value);
  }
  return { ...record, orbit };
}

// Same geometric sample density as the legacy 3D view; only the display point budget adapts to batch size.
function referenceCount(orbit, cap) {
  const a = orbit.elements.semiMajorAxisKm / EARTH_RADIUS_KM;
  const b = a * Math.sqrt(1 - orbit.elements.eccentricity ** 2);
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  return Math.max(12, Math.min(cap, Math.max(180, Math.round(perimeter / 0.028))));
}

function sessionFor(options) {
  for (const [key, value] of sessions) if (Date.now() - value.touchedAt > 30 * 60_000) sessions.delete(key);
  let session = sessions.get(options.sessionId);
  let reset = false;
  if (!session || session.resetToken !== options.resetToken) {
    session = { histories: new Map(), resetToken: options.resetToken, touchedAt: Date.now() };
    reset = true;
  }
  sessions.delete(options.sessionId);
  sessions.set(options.sessionId, session);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  for (const id of options.resetIds) session.histories.delete(id);
  session.touchedAt = Date.now();
  return { session, reset };
}

function limitHistory(history, maxPoints) {
  let count = history.currentSegment.length + history.pastSegments.reduce((sum, segment) => sum + segment.length, 0);
  let trimmed = false;
  while (count > maxPoints && history.pastSegments.length) {
    const first = history.pastSegments[0];
    const remove = Math.min(first.length, count - maxPoints);
    if (remove === first.length) history.pastSegments.shift();
    else first.splice(0, remove);
    count -= remove; trimmed = true;
  }
  if (count > maxPoints) { history.currentSegment.splice(0, count - maxPoints); trimmed = true; }
  return trimmed;
}

function groundTracks(records, payload, check) {
  const options = payload.groundTrack;
  const { session, reset } = sessionFor(options);
  const presentIds = new Set(records.map((record) => record.id));
  for (const id of session.histories.keys()) if (!presentIds.has(id)) session.histories.delete(id);
  const activeIds = options.activeIds ? new Set(options.activeIds) : null;
  const active = records.filter((record) => record.visible && (!activeIds || activeIds.has(record.id)));
  // The budget applies across all live histories in this session, including temporarily filtered tracks.
  const perRecordBudget = Math.max(24, Math.floor(API_LIMITS.groundHistoryPoints / Math.max(1, records.length)));
  const sampleCap = Math.min(options.referenceSampleCount, Math.max(12, Math.floor(API_LIMITS.referencePoints / Math.max(1, records.length))));
  const tracks = [];
  let truncated = false;
  for (const record of active) {
    check();
    const history = updateGroundTrackHistory(session.histories.get(record.id), {
      orbitRecord: record, elapsedSeconds: payload.elapsedSeconds, startUtcMs: options.startUtcMs,
      perturbationModel: payload.perturbationModel, referenceSampleCount: referenceCount(record.orbit, sampleCap),
      window: options.window, maxCatchUpPoints: Math.min(options.maxCatchUpPoints, perRecordBudget),
    });
    truncated = limitHistory(history, perRecordBudget) || truncated;
    session.histories.set(record.id, history);
    tracks.push(groundTrackTrackFromHistory(history, record, options.window));
  }
  // When the batch grows, dormant histories must also obey the lower per-record budget.
  for (const history of session.histories.values()) truncated = limitHistory(history, perRecordBudget) || truncated;
  return { tracks, groundTrack: { sessionId: options.sessionId, reset, truncated, maxHistoryPoints: API_LIMITS.groundHistoryPoints } };
}

function execute(type, payload, check, progress) {
  const records = recordsFor(payload, check);
  const modelOptions = { perturbationModel: payload.perturbationModel };
  if (type === 'prepare') {
    const cap = Math.min(payload.referenceSampleCount, Math.floor(API_LIMITS.referencePoints / Math.max(1, records.length)));
    const result = [];
    for (let index = 0; index < records.length; index += 1) {
      check();
      const record = records[index];
      const initialState = propagateOrbit(record.orbit, payload.elapsedSeconds, modelOptions);
      const reference = referenceFor(record, referenceCount(record.orbit, cap), modelOptions);
      result.push({ id: record.id, orbit: { ...record.orbit, initialState }, initialState, reference });
      progress(index + 1, records.length);
    }
    return { records: result, perturbationModel: payload.perturbationModel, referencePointBudget: API_LIMITS.referencePoints };
  }
  if (type === 'frame' || type === 'groundtrack') {
    const visibleCount = records.reduce((count, record) => count + Number(record.visible), 0);
    const trailCount = Math.min(payload.trailCount, Math.floor(API_LIMITS.frameTrailPoints / Math.max(1, visibleCount)));
    const result = [];
    if (type === 'frame') {
      for (let index = 0; index < records.length; index += 1) {
        check();
        const record = records[index];
        const state = propagateOrbit(record.orbit, payload.elapsedSeconds, modelOptions);
        const trail = [];
        if (record.visible && trailCount > 0) {
          const period = record.orbit.periodSeconds;
          const span = Math.min(period * 0.22, Math.max(420, period * 0.1));
          for (let sample = 0; sample < trailCount; sample += 1) {
            if (sample % 32 === 0) check();
            const time = payload.elapsedSeconds - span * (trailCount > 1 ? 1 - sample / (trailCount - 1) : 0);
            trail.push(propagateOrbit(record.orbit, time, modelOptions).positionKm);
          }
        }
        result.push({ id: record.id, state, trail });
        progress(index + 1, records.length);
      }
    }
    const ground = payload.groundTrack ? groundTracks(records, payload, check) : {};
    return { elapsedSeconds: payload.elapsedSeconds, perturbationModel: payload.perturbationModel, records: result, trailCount, ...ground };
  }
  if (type === 'ephemeris') {
    const result = [];
    for (let index = 0; index < records.length; index += 1) {
      check();
      const record = records[index];
      const states = payload.times.map((time, sample) => {
        if (sample % 64 === 0) check();
        return propagateOrbit(record.orbit, time, modelOptions);
      });
      result.push({ id: record.id, states });
      progress(index + 1, records.length);
    }
    return { times: payload.times, records: result, perturbationModel: payload.perturbationModel };
  }
  if (type === 'calibration') {
    const targets = [];
    const hits = [];
    let valid = false;
    for (let index = 0; index < payload.targets.length; index += 1) {
      check();
      const result = calibrateOrbitVectorTargets(records, { ...modelOptions, sampleCount: payload.sampleCount, targets: [payload.targets[index]] });
      targets.push(...result.targets); hits.push(...result.hits);
      valid = valid || result.status === 'complete';
      progress(index + 1, payload.targets.length);
    }
    return { status: valid ? 'complete' : 'no-valid-targets', perturbationModel: payload.perturbationModel, targets, hits };
  }
  throw new Error('未知任务类型。');
}

parentPort.on('message', ({ id, type, payload, compact, cancelBuffer }) => {
  const signal = new Int32Array(cancelBuffer);
  const check = () => { if (Atomics.load(signal, 0)) throw new Error('CANCELLED'); };
  let lastProgress = 0;
  const progress = (completed, total) => {
    const now = performance.now();
    if (completed === total || now - lastProgress >= 60) {
      lastProgress = now; parentPort.postMessage({ id, type: 'progress', completed, total });
    }
  };
  const startedAt = performance.now();
  cacheStats = { datasetHits: 0, referenceHits: 0, referenceMisses: 0 };
  try {
    check();
    const result = execute(type, payload, check, progress);
    check();
    const computeMs = performance.now() - startedAt;
    // Encode and transfer in the compute thread; the HTTP loop never stringifies frames.
    const encodeStartedAt = performance.now();
    const binary = compact && type === 'frame' ? encodeFrame(result) : undefined;
    const json = binary ? undefined : JSON.stringify(result);
    const bytes = binary?.byteLength ?? Buffer.byteLength(json);
    if (bytes > API_LIMITS.resultBytes) throw new Error('计算结果超过 64 MiB，请减少轨道或采样数量。');
    check();
    parentPort.postMessage({ id, type: 'result', json, binary, bytes,
      datasetKeys: [...datasets.keys()], cache: cacheStats,
      timings: { computeMs, encodeMs: performance.now() - encodeStartedAt } }, binary ? [binary.buffer] : []);
  } catch (error) {
    parentPort.postMessage({ id, type: error.message === 'CANCELLED' ? 'cancelled' : 'error', error: error.message,
      datasetKeys: [...datasets.keys()] });
  }
});
