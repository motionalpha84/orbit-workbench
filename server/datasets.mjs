import { randomUUID } from 'node:crypto';
import { API_LIMITS, HttpError, normalizeRecords } from './validation.mjs';

function missing() {
  return Object.assign(new HttpError(410, '轨道数据集不存在或已过期，请重新上传。'), { code: 'DATASET_EXPIRED' });
}

/** Immutable revisions live for this server session; project persistence stays explicit. */
export class DatasetStore {
  constructor({ maxDatasets = 16, maxBytes = 64 * 1024 * 1024, ttlMs = 30 * 60_000, now = Date.now } = {}) {
    if (!Number.isInteger(maxDatasets) || maxDatasets < 1 || !Number.isFinite(maxBytes) || maxBytes <= 0
      || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('数据集缓存预算必须为正数。');
    this.entries = new Map();
    this.maxDatasets = maxDatasets;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.bytes = 0;
  }

  cleanup() {
    for (const [id, entry] of this.entries) if (this.now() - entry.touchedAt >= this.ttlMs) this.delete(id);
  }

  delete(id) {
    const previous = this.entries.get(id);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(id); }
    return Boolean(previous);
  }

  get(id, revision) {
    this.cleanup();
    const entry = this.entries.get(id);
    if (!entry) throw missing();
    if (revision !== undefined && revision !== entry.revision) {
      throw Object.assign(new HttpError(409, '轨道数据集版本不匹配，请刷新后重试。'), { code: 'DATASET_REVISION' });
    }
    entry.touchedAt = this.now();
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  set(rawRecords, { id, revision } = {}) {
    this.cleanup();
    const previous = id ? this.get(id, revision) : null;
    if (id && !Number.isInteger(revision)) throw new HttpError(422, '更新数据集必须提供当前 revision。');
    const records = normalizeRecords(rawRecords);
    const bytes = Buffer.byteLength(JSON.stringify(records));
    if (bytes > Math.min(this.maxBytes, API_LIMITS.requestBytes)) throw new HttpError(413, '数据集超过内存预算。');
    const entry = { id: id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, records, bytes, touchedAt: this.now() };
    if (previous) this.delete(id);
    while (this.entries.size >= this.maxDatasets || this.bytes + bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    this.entries.set(entry.id, entry);
    this.bytes += bytes;
    return entry;
  }

  describe(entry) { return { datasetId: entry.id, revision: entry.revision, records: entry.records.length, expiresInMs: this.ttlMs }; }
  statistics() { this.cleanup(); return { count: this.entries.size, bytes: this.bytes, maxDatasets: this.maxDatasets, maxBytes: this.maxBytes, ttlMs: this.ttlMs }; }
  clear() { this.entries.clear(); this.bytes = 0; }
}
