import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { API_LIMITS, HttpError } from './validation.mjs';

const finalStates = new Set(['completed', 'failed', 'cancelled']);
const workerUrl = new URL('./worker.mjs', import.meta.url);

export class ComputePool extends EventEmitter {
  constructor({ workers = 2, maxQueue = API_LIMITS.queuedJobs, timeoutMs = API_LIMITS.taskTimeoutMs } = {}) {
    super();
    this.setMaxListeners(100);
    this.size = Math.max(1, Math.floor(workers));
    this.maxQueue = maxQueue;
    this.timeoutMs = timeoutMs;
    this.jobs = new Map();
    this.queue = [];
    this.slots = [];
    this.closed = false;
    this.counts = { completed: 0, failed: 0, cancelled: 0 };
    for (let index = 0; index < this.size; index += 1) this.spawn(index);
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  spawn(index) {
    if (this.closed) return;
    const worker = new Worker(workerUrl, { resourceLimits: { maxOldGenerationSizeMb: 768 } });
    const slot = { index, worker, job: null, datasetKeys: new Set() };
    this.slots[index] = slot;
    worker.on('message', (message) => this.receive(slot, message));
    worker.on('error', (error) => this.workerFailed(slot, error));
    worker.on('exit', (code) => {
      if (this.slots[index] === slot && !this.closed) this.workerFailed(slot, new Error(`计算线程已退出 (${code})。`));
    });
  }

  workerFailed(slot, error) {
    if (this.slots[slot.index] !== slot || this.closed) return;
    this.slots[slot.index] = null;
    if (slot.job && !finalStates.has(slot.job.status)) this.finish(slot.job, 'failed', { error: error.message });
    this.clearTimers(slot.job);
    slot.worker.terminate().catch(() => {});
    this.spawn(slot.index);
    this.dispatch();
  }

  affinity(payload) {
    const sessionId = payload.groundTrack?.sessionId;
    if (!sessionId) return null;
    let hash = 2166136261;
    for (const character of sessionId) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    return (hash >>> 0) % this.size;
  }

  submit(type, payload, { ephemeral = false, compact = false } = {}) {
    if (this.closed) throw new HttpError(503, '计算服务已关闭。');
    if (this.queue.length >= this.maxQueue) throw new HttpError(429, '计算队列已满，请稍后重试。');
    this.cleanup();
    const job = {
      id: randomUUID(), type, payload, ephemeral, compact, affinity: this.affinity(payload), status: 'queued',
      progress: 0, completed: 0, total: payload.records.length, createdAt: Date.now(),
      cancelSignal: new Int32Array(new SharedArrayBuffer(4)), resultBytes: 0,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.publish(job);
    this.dispatch();
    return job;
  }

  dispatch() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (!slot || slot.job) continue;
      const queueIndex = this.queue.findIndex((job) => job.affinity === null || job.affinity === slot.index);
      if (queueIndex < 0) continue;
      const [job] = this.queue.splice(queueIndex, 1);
      slot.job = job;
      job.status = 'running';
      job.startedAt = Date.now();
      this.publish(job);
      job.timeout = setTimeout(() => this.workerFailed(slot, new Error('计算超过 120 秒限制，请减小批次后重试。')), this.timeoutMs);
      job.timeout.unref();
      const payload = job.payload.datasetKey && slot.datasetKeys.has(job.payload.datasetKey)
        ? { ...job.payload, records: undefined } : job.payload;
      slot.worker.postMessage({ id: job.id, type: job.type, payload, compact: job.compact, cancelBuffer: job.cancelSignal.buffer });
      job.payload = null;
    }
  }

  receive(slot, message) {
    if (this.slots[slot.index] !== slot || !slot.job || message.id !== slot.job.id) return;
    const job = slot.job;
    if (message.type === 'progress') {
      if (job.status === 'running') {
        job.completed = message.completed;
        job.total = message.total;
        job.progress = message.total ? Math.min(1, message.completed / message.total) : 0;
        this.publish(job);
      }
      return;
    }
    this.clearTimers(job);
    if (message.datasetKeys) slot.datasetKeys = new Set(message.datasetKeys);
    slot.job = null;
    if (!finalStates.has(job.status)) {
      if (message.type === 'result') {
        if (message.bytes > API_LIMITS.resultBytes) this.finish(job, 'failed', { error: '计算结果超过 64 MiB，请减小批次。' });
        else this.finish(job, 'completed', { resultJson: message.json, resultBinary: message.binary,
          resultBytes: message.bytes, timings: message.timings, cache: message.cache });
      } else this.finish(job, message.type === 'cancelled' ? 'cancelled' : 'failed', { error: message.error || '计算线程返回错误。' });
    }
    this.cleanup();
    this.dispatch();
  }

  clearTimers(job) {
    if (!job) return;
    clearTimeout(job.timeout);
    clearTimeout(job.cancelTimeout);
  }

  finish(job, status, fields = {}) {
    Object.assign(job, fields, { status, finishedAt: Date.now(), payload: null });
    if (status === 'completed') { job.progress = 1; job.completed = job.total; }
    this.counts[status] += 1;
    this.publish(job);
  }

  publish(job) { this.emit('change', this.describe(job)); }
  get(id) { return this.jobs.get(id); }

  describe(job) {
    return {
      id: job.id, type: job.type, status: job.status, progress: job.progress,
      completed: job.completed, total: job.total, createdAt: job.createdAt,
      startedAt: job.startedAt ?? null, finishedAt: job.finishedAt ?? null,
      durationMs: job.startedAt ? (job.finishedAt ?? Date.now()) - job.startedAt : 0,
      resultBytes: job.resultBytes, ...(job.error ? { error: job.error } : {}),
      ...(job.timings ? { timings: job.timings, cache: job.cache } : {}),
    };
  }

  list() { return [...this.jobs.values()].filter((job) => !job.ephemeral).reverse().map((job) => this.describe(job)); }
  statistics() {
    return { workers: this.size, running: this.slots.filter((slot) => slot?.job).length, queued: this.queue.length,
      ...this.counts, retainedJobs: this.jobs.size, resultBytes: [...this.jobs.values()].reduce((sum, job) => sum + job.resultBytes, 0) };
  }

  wait(id) {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new HttpError(404, '任务不存在。'));
    return new Promise((resolve, reject) => {
      const inspect = () => {
        if (!finalStates.has(job.status)) return;
        this.off('change', changed);
        if (job.status === 'completed') resolve(job);
        else reject(new HttpError(job.status === 'cancelled' ? 409 : 422, job.error || '计算任务已取消。'));
      };
      const changed = (entry) => { if (entry.id === id) inspect(); };
      this.on('change', changed);
      inspect();
    });
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || finalStates.has(job.status)) return false;
    Atomics.store(job.cancelSignal, 0, 1);
    this.queue = this.queue.filter((queued) => queued !== job);
    this.finish(job, 'cancelled');
    const slot = this.slots.find((entry) => entry?.job === job);
    if (slot) {
      // Cooperative cancellation retains unrelated ground-track sessions. Kill a stuck kernel after the grace period.
      job.cancelTimeout = setTimeout(() => {
        if (slot.job === job) this.workerFailed(slot, new Error('已终止取消的计算线程。'));
      }, 1500);
      job.cancelTimeout.unref();
    }
    this.dispatch();
    return true;
  }

  release(id) {
    const job = this.jobs.get(id);
    if (job && finalStates.has(job.status)) this.jobs.delete(id);
  }

  cleanup() {
    const terminal = [...this.jobs.values()].filter((job) => !job.ephemeral && finalStates.has(job.status)).sort((a, b) => a.finishedAt - b.finishedAt);
    let retainedBytes = [...this.jobs.values()].reduce((sum, job) => sum + job.resultBytes, 0);
    let count = terminal.length;
    for (const job of terminal) {
      if (count > API_LIMITS.retainedJobs || retainedBytes > API_LIMITS.retainedResultBytes || Date.now() - job.finishedAt > 600_000) {
        this.jobs.delete(job.id); retainedBytes -= job.resultBytes; count -= 1;
      }
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.cleanupTimer);
    for (const job of this.jobs.values()) {
      this.clearTimers(job);
      if (!finalStates.has(job.status)) this.finish(job, 'cancelled', { error: '计算服务已关闭。' });
    }
    this.queue.length = 0;
    await Promise.all(this.slots.filter(Boolean).map((slot) => slot.worker.terminate()));
    this.jobs.clear();
    this.slots.length = 0;
  }
}
