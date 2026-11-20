import { decodeFrame, FRAME_MIME } from './frame-codec.mjs';

/** HTTP transport. Numerical propagation is exclusively performed by Node workers. */
export class BackendClient {
  constructor({ fetchImpl = globalThis.fetch.bind(globalThis), onChange = () => {} } = {}) {
    this.fetch = fetchImpl;
    this.onChange = onChange;
    this.jobs = new Map();
    this.health = null;
    this.connected = false;
    this.error = '';
    this.logs = [];
    // App records are immutable snapshots: a changed root element, label, color or
    // visibility creates a new array. Weak keys avoid retaining closed workspaces.
    this.datasets = new WeakMap();
  }

  emit() { this.onChange(this); }
  log(message) {
    this.logs.unshift(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`);
    this.logs.length = Math.min(this.logs.length, 60);
    this.emit();
  }

  async request(path, { timeout = 120000, ...options } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetch(path, {
        ...options, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      const contentType = response.headers?.get?.('content-type')?.split(';')[0];
      const data = response.ok && contentType === FRAME_MIME
        ? decodeFrame(await response.arrayBuffer()) : await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error?.message ?? data.error ?? `请求失败 (${response.status})`),
        { status: response.status, code: data.code });
      this.connected = true;
      this.error = '';
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('后台响应超时，请检查计算服务。');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async checkHealth() {
    try {
      this.health = await this.request('/api/health', { timeout: 4000 });
    } catch (error) {
      this.connected = false;
      this.error = '后台未连接，请运行 start-workbench.bat';
    }
    this.emit();
    return this.connected;
  }

  async run(type, payload, label = type) {
    const created = await this.request('/api/jobs', { method: 'POST', body: JSON.stringify({ type, payload }) });
    const job = { ...created, label };
    this.jobs.set(job.id, job);
    this.log(`${label} · 已提交`);
    try {
      for (;;) {
        if (job.status === 'completed') {
          const result = await this.request(`/api/jobs/${job.id}/result`);
          this.log(`${label} · 已完成`);
          return result;
        }
        if (['failed', 'cancelled', 'canceled'].includes(job.status)) {
          throw new Error(job.error?.message ?? job.error ?? (job.status === 'failed' ? '计算失败' : '任务已取消'));
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
        Object.assign(job, await this.request(`/api/jobs/${job.id}`));
        this.emit();
      }
    } catch (error) {
      if (!['cancelled', 'canceled'].includes(job.status)) job.status = 'failed';
      job.error = error.message;
      this.log(`${label} · ${error.message}`);
      throw error;
    } finally {
      const finished = [...this.jobs.values()].filter((item) => ['completed', 'failed', 'cancelled', 'canceled'].includes(item.status));
      finished.slice(0, -8).forEach((item) => this.jobs.delete(item.id));
      this.emit();
    }
  }

  async cancel() {
    const active = [...this.jobs.values()].filter((job) => ['queued', 'running'].includes(job.status));
    await Promise.all(active.map(async (job) => {
      Object.assign(job, await this.request(`/api/jobs/${job.id}`, { method: 'DELETE' }));
    }));
    this.emit();
  }

  ensureDataset(records, force = false) {
    if (force) this.datasets.delete(records);
    let pending = this.datasets.get(records);
    if (!pending) {
      pending = this.request('/api/datasets', { method: 'POST', body: JSON.stringify({ records }) });
      this.datasets.set(records, pending);
      pending.catch(() => { if (this.datasets.get(records) === pending) this.datasets.delete(records); });
    }
    return pending;
  }

  async frame(payload) {
    const send = (body, compact = false) => this.request('/api/compute/frame', {
      method: 'POST', body: JSON.stringify(body), timeout: 30000,
      ...(compact ? { headers: { Accept: FRAME_MIME } } : {}),
    });
    // Capability negotiation preserves old servers and explicit JSON API callers.
    if (!this.health?.capabilities?.datasets || payload.datasetId) return send(payload);
    const { records = payload.orbits ?? [], orbits, ...options } = payload;
    if (!Array.isArray(records)) return send(payload);
    const compact = Boolean(this.health.capabilities.compactFrames);
    const request = async (renew = false) => {
      const registered = await this.ensureDataset(records, renew);
      return send({ ...options, datasetId: registered.datasetId, revision: registered.revision }, compact);
    };
    try { return await request(); }
    catch (error) {
      if (error.code === 'DATASET_EXPIRED' || error.code === 'DATASET_REVISION' || error.status === 404 || error.status === 410) {
        return request(true); // one recovery after TTL eviction or server restart
      }
      throw error;
    }
  }
}
