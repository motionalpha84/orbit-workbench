import test from 'node:test';
import assert from 'node:assert/strict';
import { BackendClient } from '../js/backend-client.mjs';

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return data; } });

test('HTTP client polls queued work and fetches only the completed backend result', async () => {
  const calls = [];
  let polls = 0;
  let changes = 0;
  const result = { records: [{ id: 'orbit-1', reference: [{ positionKm: { x: 7000, y: 0, z: 0 } }] }] };
  const client = new BackendClient({
    onChange() { changes += 1; },
    async fetchImpl(path, options) {
      calls.push({ path, method: options.method ?? 'GET', body: options.body && JSON.parse(options.body) });
      if (path === '/api/jobs') return response({ id: 'job-1', status: 'queued', progress: 0 });
      if (path.endsWith('/result')) return response(result);
      polls += 1;
      return response({ id: 'job-1', status: polls === 1 ? 'running' : 'completed', progress: polls === 1 ? 0.5 : 1 });
    },
  });
  assert.deepEqual(await client.run('prepare', { records: [{ id: 'orbit-1' }] }, '准备'), result);
  assert.deepEqual(calls[0].body, { type: 'prepare', payload: { records: [{ id: 'orbit-1' }] } });
  assert.equal(calls.filter((call) => call.path.endsWith('/result')).length, 1);
  assert.equal(client.jobs.get('job-1').status, 'completed');
  assert.equal(client.connected, true);
  assert.ok(changes >= 3);
});

test('HTTP client surfaces worker failure and never requests a failed result', async () => {
  const calls = [];
  const client = new BackendClient({ async fetchImpl(path) {
    calls.push(path);
    if (path === '/api/jobs') return response({ id: 'bad-job', status: 'queued' });
    return response({ id: 'bad-job', status: 'failed', error: { message: '轨道参数无效' } });
  } });
  await assert.rejects(client.run('prepare', { records: [] }), /轨道参数无效/);
  assert.equal(calls.some((path) => path.endsWith('/result')), false);
  assert.equal(client.jobs.get('bad-job').status, 'failed');
  assert.ok(client.logs.some((message) => message.includes('轨道参数无效')));
});

test('cancel sends DELETE for active jobs and the waiting operation rejects', async () => {
  let queuedResolve;
  const queued = new Promise((resolve) => { queuedResolve = resolve; });
  let deleted = false;
  const calls = [];
  const client = new BackendClient({
    onChange(current) { if (current.jobs.has('cancel-me')) queuedResolve(); },
    async fetchImpl(path, options) {
      calls.push({ path, method: options.method ?? 'GET' });
      if (path === '/api/jobs') return response({ id: 'cancel-me', status: 'queued' });
      if (options.method === 'DELETE') deleted = true;
      return response({ id: 'cancel-me', status: deleted ? 'cancelled' : 'running' });
    },
  });
  const pending = client.run('calibration', { targets: [] });
  const rejection = assert.rejects(pending, /任务已取消/);
  await queued;
  await client.cancel();
  await rejection;
  assert.ok(calls.some((call) => call.path === '/api/jobs/cancel-me' && call.method === 'DELETE'));
  assert.equal(client.jobs.get('cancel-me').status, 'cancelled');
});

test('direct frames use backend snapshots verbatim and reject offline without a fallback', async () => {
  const payload = { elapsedSeconds: 180, records: [{ id: 'orbit-1' }], trailCount: 32 };
  const snapshot = { elapsedSeconds: 180, records: [{ id: 'orbit-1', state: { positionKm: { x: 1, y: 2, z: 3 } }, trail: [] }] };
  const calls = [];
  let offline = false;
  const client = new BackendClient({ async fetchImpl(path, options) {
    calls.push({ path, options });
    if (offline) throw new TypeError('Failed to fetch');
    return response(snapshot);
  } });
  assert.equal(await client.frame(payload), snapshot);
  assert.equal(calls[0].path, '/api/compute/frame');
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  offline = true;
  await assert.rejects(client.frame(payload), /Failed to fetch/);
  assert.equal(calls.length, 2, 'failed transport does not trigger an alternate compute path');
});

test('unavailable health check exposes disconnected state and a later check recovers', async () => {
  let available = false;
  const client = new BackendClient({ async fetchImpl() {
    if (!available) throw new TypeError('Failed to fetch');
    return response({ workers: 2, queued: 0 });
  } });
  assert.equal(await client.checkHealth(), false);
  assert.equal(client.connected, false);
  assert.match(client.error, /start-workbench\.bat/);
  available = true;
  assert.equal(await client.checkHealth(), true);
  assert.equal(client.error, '');
  assert.equal(client.health.workers, 2);
});

test('HTTP failures and request deadlines produce actionable transport errors', async () => {
  const rejected = new BackendClient({ fetchImpl: async () => response({ error: { message: '任务队列已满' } }, 429) });
  await assert.rejects(rejected.frame({}), /任务队列已满/);
  const timedOut = new BackendClient({ fetchImpl: async (path, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }) });
  await assert.rejects(timedOut.request('/api/health', { timeout: 5 }), /后台响应超时/);
});
