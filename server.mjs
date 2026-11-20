import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';
import { ComputePool } from './server/pool.mjs';
import { API_LIMITS, HttpError, validateTask } from './server/validation.mjs';
import { DatasetStore } from './server/datasets.mjs';
import { FRAME_MIME } from './js/frame-codec.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const publicFiles = new Set(['index.html', 'styles.css', 'styles-v21.css']);
const publicDirectories = new Set(['js', 'assets', 'vendor']);

function sendJson(response, status, value, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extraHeaders,
  });
  response.end(body);
}

function sendResult(response, job) {
  const headers = { 'X-Compute-Job': job.id,
    ...(job.timings ? { 'Server-Timing': `compute;dur=${job.timings.computeMs.toFixed(3)}, encode;dur=${job.timings.encodeMs.toFixed(3)}` } : {}),
    'X-Dataset-Cache': job.cache?.datasetHits ? 'hit' : 'miss',
    'X-Reference-Cache-Hits': String(job.cache?.referenceHits ?? 0) };
  if (!job.resultBinary) return sendJson(response, 200, job.resultJson, headers);
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(200, { 'Content-Type': FRAME_MIME, 'Content-Length': job.resultBytes,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(job.resultBinary);
}

async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, '请求必须使用 application/json。');
  }
  if (Number(request.headers['content-length']) > API_LIMITS.requestBytes) throw new HttpError(413, '请求内容超过 16 MiB 限制。');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > API_LIMITS.requestBytes) throw new HttpError(413, '请求内容超过 16 MiB 限制。');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch { throw new HttpError(400, '请求内容必须是有效的 JSON 对象。'); }
}

// Only browser assets are public; source archives and server files stay private.
async function publicPath(rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { throw new HttpError(400, '无效的 URL 编码。'); }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part.startsWith('.'))) return null;
  if (!parts.length) parts.push('index.html');
  if (!(parts.length === 1 && publicFiles.has(parts[0])) && !publicDirectories.has(parts[0])) return null;
  const candidate = resolve(root, ...parts);
  try {
    const actual = await realpath(candidate);
    const fromRoot = relative(await realpath(root), actual);
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return null;
    const information = await stat(actual);
    return information.isFile() ? { path: actual, size: information.size } : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

export function createWorkbenchServer(options = {}) {
  const requestedWorkers = Number(options.workers ?? process.env.ORBIT_WORKERS);
  const workers = Number.isInteger(requestedWorkers) && requestedWorkers > 0
    ? Math.min(16, requestedWorkers) : Math.max(1, Math.min(4, availableParallelism() - 1));
  const pool = new ComputePool({ workers, ...options.poolOptions });
  const datasets = new DatasetStore(options.datasetOptions);
  const resolveTask = (type, raw) => {
    if (raw?.datasetId === undefined) return validateTask(type, raw);
    if (typeof raw.datasetId !== 'string' || !raw.datasetId || !Number.isInteger(raw.revision) || raw.revision < 1) {
      throw new HttpError(422, '数据集请求必须包含 datasetId 和正整数 revision。');
    }
    if (raw.records !== undefined || raw.orbits !== undefined) throw new HttpError(422, '数据集请求不能同时包含 records。');
    const entry = datasets.get(raw.datasetId, raw.revision);
    const task = validateTask(type, raw, entry.records);
    task.payload.datasetKey = `${entry.id}:${entry.revision}`;
    return task;
  };
  const events = new Set();
  let shuttingDown = false;
  const server = createServer(async (request, response) => {
    try {
      const host = String(request.headers.host || '').toLowerCase();
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new HttpError(403, '该服务仅接受本机地址访问。');
      const rawPath = (request.url || '/').split('?')[0];
      if (rawPath.startsWith('/api/')) {
        const origin = request.headers.origin;
        if (origin && origin !== `http://${host}` && origin !== `https://${host}`) throw new HttpError(403, '不允许跨来源访问计算接口。');
        if (shuttingDown) throw new HttpError(503, '计算服务正在关闭。');
        if (request.method === 'GET' && rawPath === '/api/health') {
          sendJson(response, 200, { ok: true, name: '轨道仿真工作台', version: '0.2.0', architecture: 'worker_threads',
            capabilities: { datasets: true, compactFrames: true }, datasets: datasets.statistics(),
            uptimeSeconds: process.uptime(), ...pool.statistics(), limits: API_LIMITS });
          return;
        }
        if (request.method === 'POST' && rawPath === '/api/datasets') {
          const body = await readJson(request);
          const entry = datasets.set(body.records ?? body.orbits);
          sendJson(response, 201, datasets.describe(entry)); return;
        }
        const datasetMatch = rawPath.match(/^\/api\/datasets\/([a-f0-9-]+)$/);
        if (datasetMatch) {
          if (request.method === 'GET') { sendJson(response, 200, datasets.describe(datasets.get(datasetMatch[1]))); return; }
          if (request.method === 'PUT') {
            const body = await readJson(request);
            const entry = datasets.set(body.records ?? body.orbits, { id: datasetMatch[1], revision: body.revision });
            sendJson(response, 200, datasets.describe(entry)); return;
          }
          if (request.method === 'DELETE') { datasets.delete(datasetMatch[1]); sendJson(response, 200, { deleted: true }); return; }
        }
        if (request.method === 'GET' && rawPath === '/api/jobs') {
          sendJson(response, 200, { jobs: pool.list(), ...pool.statistics() }); return;
        }
        if (request.method === 'GET' && rawPath === '/api/events') {
          if (events.size >= 16) throw new HttpError(429, '进度连接已达到上限。');
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          response.write(`event: health\ndata: ${JSON.stringify(pool.statistics())}\n\n`);
          events.add(response);
          response.on('close', () => events.delete(response));
          return;
        }
        if (request.method === 'POST' && rawPath === '/api/jobs') {
          const body = await readJson(request);
          const task = resolveTask(body.type, body.payload ?? body);
          const job = pool.submit(task.type, task.payload);
          sendJson(response, 202, pool.describe(job), { Location: `/api/jobs/${job.id}` }); return;
        }
        const direct = rawPath.match(/^\/api\/compute\/(prepare|frame|ephemeris|calibration|groundtrack)$/)
          || (rawPath === '/api/ephemeris' ? [null, 'ephemeris'] : null);
        if (request.method === 'POST' && direct) {
          const body = await readJson(request);
          const task = resolveTask(direct[1], body.payload ?? body);
          const compact = task.type === 'frame' && String(request.headers.accept || '').split(',').some(value => value.trim() === FRAME_MIME);
          const job = pool.submit(task.type, task.payload, { ephemeral: true, compact });
          response.setHeader('X-Compute-Job', job.id);
          const onClose = () => { if (!response.writableEnded) pool.cancel(job.id); };
          response.once('close', onClose);
          try {
            const completed = await pool.wait(job.id);
            sendResult(response, completed);
          } finally { response.off('close', onClose); pool.release(job.id); }
          return;
        }
        const match = rawPath.match(/^\/api\/jobs\/([a-f0-9-]+)(\/result)?$/);
        if (match) {
          const job = pool.get(match[1]);
          if (!job) throw new HttpError(404, '任务不存在或已过期。');
          if (request.method === 'GET' && match[2]) {
            if (job.status !== 'completed') sendJson(response, job.status === 'failed' ? 422 : job.status === 'cancelled' ? 410 : 202, pool.describe(job));
            else sendJson(response, 200, job.resultJson);
            return;
          }
          if (request.method === 'GET' && !match[2]) { sendJson(response, 200, pool.describe(job)); return; }
          if (request.method === 'DELETE' && !match[2]) { pool.cancel(job.id); sendJson(response, 200, pool.describe(job)); return; }
        }
        throw new HttpError(404, '计算接口不存在。');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD'); throw new HttpError(405, '静态资源仅支持 GET 和 HEAD。');
      }
      const file = await publicPath(rawPath);
      if (!file) throw new HttpError(404, '文件不存在。');
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(file.path).toLowerCase()] || 'application/octet-stream', 'Content-Length': file.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file.path).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (response.headersSent) { if (!response.writableEnded) response.destroy(); }
      else sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : '服务器处理失败，请查看服务日志。',
        ...(error.code?.startsWith('DATASET_') ? { code: error.code } : {}) });
      if (!error.statusCode && error.code !== 'ECONNRESET') console.error('[server]', error);
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  pool.on('change', (job) => {
    const message = `event: job\ndata: ${JSON.stringify(job)}\n\n`;
    for (const response of events) if (!response.write(message)) { events.delete(response); response.destroy(); }
  });
  const heartbeat = setInterval(() => { for (const response of events) response.write(': heartbeat\n\n'); }, 15_000);
  heartbeat.unref();
  async function close() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeat);
    for (const response of events) response.end();
    events.clear();
    datasets.clear();
    await pool.close();
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  }
  return { server, pool, datasets, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数。');
  const application = createWorkbenchServer();
  application.server.listen(port, '127.0.0.1', () => {
    console.log(`Orbit Workbench v0.2.0 · 后台计算服务 http://127.0.0.1:${port}`);
    console.log(`计算线程 ${application.pool.size} · Ctrl+C 关闭服务`);
  });
  application.server.on('error', async (error) => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请关闭旧服务或设置 PORT。` : error.message);
    await application.close(); process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => application.close());
}

