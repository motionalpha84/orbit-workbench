/** Reproducible local transport benchmark: node server/benchmark.mjs [100,1000,5000] */
import { cpus, totalmem } from 'node:os';
import { createWorkbenchServer } from '../server.mjs';
import { FRAME_MIME, decodeFrame } from '../js/frame-codec.mjs';

const counts = (process.argv[2] || '100,1000,5000').split(',').map(Number);
if (counts.some(count => !Number.isInteger(count) || count < 1 || count > 5000)) throw new Error('轨道数范围为 1–5000。');
const application = createWorkbenchServer({ workers: 1 });
await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${application.server.address().port}`;
const environment = { node: process.version, platform: process.platform, cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3), workers: 1, rounds: 5,
  note: 'Same v2 worker kernel; legacy records/JSON versus registered dataset/Float64. HTTP timings include Node client encoding and decoding; this does not measure browser FPS.' };

async function post(path, payload, compact = false) {
  const started = performance.now();
  const body = JSON.stringify(payload);
  const response = await fetch(`${base}${path}`, { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', ...(compact ? { Accept: FRAME_MIME } : {}) } });
  const buffer = await response.arrayBuffer();
  const decodeStarted = performance.now();
  const data = compact && response.ok ? decodeFrame(buffer) : JSON.parse(new TextDecoder().decode(buffer));
  if (!response.ok) throw new Error(data.error);
  return { data, ms: performance.now() - started, decodeMs: performance.now() - decodeStarted,
    requestBytes: Buffer.byteLength(body), responseBytes: buffer.byteLength,
    serverTiming: response.headers.get('server-timing'), cacheHits: response.headers.get('x-reference-cache-hits') };
}
function median(values) { return values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
function differences(legacy, compact) {
  let maxNumericDifference = 0;
  let checkedNumbers = 0;
  const compare = (left, right) => {
    if (typeof left === 'number') {
      if (typeof right !== 'number' || !Number.isFinite(right)) throw new Error('非有限或缺失的精度比较字段。');
      maxNumericDifference = Math.max(maxNumericDifference, Math.abs(left - right));
      checkedNumbers += 1;
    } else if (left && typeof left === 'object') {
      if (!right || Object.keys(left).length !== Object.keys(right).length) throw new Error('帧结果字段数量不同。');
      for (const key of Object.keys(left)) compare(left[key], right[key]);
    } else if (left !== right) throw new Error('帧结果元数据不同。');
  };
  compare(legacy, compact);
  if (maxNumericDifference !== 0) throw new Error(`帧精度发生变化：${maxNumericDifference}`);
  return { maxNumericDifference, checkedNumbers };
}
try {
  console.log(JSON.stringify({ environment }));
  for (const count of counts) {
    const records = Array.from({ length: count }, (_, index) => ({ id: `orbit-${index}`, name: `轨道 ${index}`, visible: true,
      color: '#7fe8d2', elements: { semiMajorAxisKm: 7000 + index * 0.01, eccentricity: 0.001,
        inclinationDeg: 51.6, raanDeg: index % 360, argPeriapsisDeg: 30, trueAnomalyDeg: index % 90 } }));
    const registered = await post('/api/datasets', { records });
    const dataset = { datasetId: registered.data.datasetId, revision: registered.data.revision };
    const options = { elapsedSeconds: 5432.123456789, trailCount: 32, perturbationModel: 'j3' };
    await post('/api/compute/frame', { ...dataset, ...options }, true);
    await post('/api/compute/frame', { records, ...options });
    const legacy = [], compact = [];
    for (let round = 0; round < 5; round += 1) {
      legacy.push(await post('/api/compute/frame', { records, ...options }));
      compact.push(await post('/api/compute/frame', { ...dataset, ...options }, true));
    }
    const format = runs => ({ medianMs: +median(runs.map(run => run.ms)).toFixed(2),
      medianDecodeMs: +median(runs.map(run => run.decodeMs)).toFixed(2),
      requestBytes: runs[0].requestBytes, responseBytes: runs[0].responseBytes,
      lastServerTiming: runs.at(-1).serverTiming });
    const prepareOptions = { ...dataset, perturbationModel: 'j3', referenceSampleCount: 120 };
    const cold = await post('/api/compute/prepare', prepareOptions);
    const warm = await post('/api/compute/prepare', prepareOptions);
    console.log(JSON.stringify({ records: count, legacy: format(legacy), compact: format(compact),
      precision: differences(legacy[0].data, compact[0].data),
      prepare: { coldMs: +cold.ms.toFixed(2), warmMs: +warm.ms.toFixed(2), referenceCacheHits: Number(warm.cacheHits),
        coldServerTiming: cold.serverTiming, warmServerTiming: warm.serverTiming },
      requestReductionPercent: +(100 * (1 - compact[0].requestBytes / legacy[0].requestBytes)).toFixed(2),
      responseReductionPercent: +(100 * (1 - compact[0].responseBytes / legacy[0].responseBytes)).toFixed(2),
      datasetUploadBytes: registered.requestBytes }));
  }
} finally { await application.close(); }
