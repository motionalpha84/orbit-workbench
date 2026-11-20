export const API_LIMITS = Object.freeze({
  requestBytes: 16 * 1024 * 1024, resultBytes: 64 * 1024 * 1024,
  records: 5000, queuedJobs: 64, retainedJobs: 32, retainedResultBytes: 128 * 1024 * 1024,
  referencePoints: 300_000, frameTrailPoints: 200_000, ephemerisStates: 100_000,
  groundHistoryPoints: 300_000, taskTimeoutMs: 120_000,
});

export class HttpError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}

function finite(value, name, { fallback, min = -1e15, max = 1e15, integer = false } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === null || value === '' || typeof value === 'boolean') throw new HttpError(422, `${name} 必须是有效数值。`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new HttpError(422, `${name} 必须在 ${min}–${max} 范围内${integer ? '且为整数' : ''}。`);
  }
  return number;
}

export function normalizeRecords(value) {
  if (!Array.isArray(value) || value.length > API_LIMITS.records) throw new HttpError(422, `records 必须是数组，每个任务最多 ${API_LIMITS.records} 条轨道。`);
  const ids = new Set();
  return value.map((record, index) => {
    if (!record || typeof record !== 'object') throw new HttpError(422, `轨道 ${index + 1} 格式错误。`);
    const id = String(record.id ?? `orbit-${index + 1}`);
    if (id.length > 160 || ids.has(id)) throw new HttpError(422, '轨道 id 必须唯一且不超过 160 字符。');
    ids.add(id);
    const raw = record.elements ?? record.orbit?.elements ?? record;
    if (!raw || typeof raw !== 'object') throw new HttpError(422, `轨道 ${index + 1} 缺少根数。`);
    const elements = { name: String(record.name ?? raw.name ?? `Orbit ${index + 1}`).slice(0, 200) };
    for (const field of ['semiMajorAxisKm', 'eccentricity', 'inclinationDeg', 'raanDeg', 'argPeriapsisDeg', 'trueAnomalyDeg']) elements[field] = finite(raw[field], `轨道 ${index + 1} ${field}`);
    if (elements.semiMajorAxisKm <= 0 || elements.eccentricity < 0 || elements.eccentricity >= 1 || elements.semiMajorAxisKm * (1 - elements.eccentricity) <= 6378.137) {
      throw new HttpError(422, `轨道 ${index + 1} 必须为近地点高于地球表面的椭圆轨道。`);
    }
    return { id, name: elements.name, color: String(record.color ?? '#7fe8d2').slice(0, 32), visible: record.visible !== false, elements };
  });
}

function groundOptions(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(422, 'groundTrack 格式错误。');
  const sessionId = String(raw.sessionId ?? 'default');
  if (!sessionId || sessionId.length > 160) throw new HttpError(422, '地面轨迹 sessionId 必须为 1–160 字符。');
  const rawWindow = raw.window ?? {};
  const window = {
    mode: rawWindow.mode === 'time' ? 'time' : 'revs',
    pastRevs: finite(rawWindow.pastRevs, 'pastRevs', { fallback: 2, min: 0, max: 1000, integer: true }),
    pastSeconds: finite(rawWindow.pastSeconds, 'pastSeconds', { fallback: 0, min: 0, max: 1e12 }),
  };
  const ids = (value, label) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > API_LIMITS.records || value.some((id) => typeof id !== 'string' || id.length > 160)) throw new HttpError(422, `${label} 必须是轨道 id 数组。`);
    return value;
  };
  return {
    sessionId, resetToken: String(raw.resetToken ?? '').slice(0, 160), resetIds: ids(raw.resetIds, 'resetIds') ?? [], activeIds: ids(raw.activeIds, 'activeIds'),
    startUtcMs: finite(raw.startUtcMs, 'startUtcMs', { fallback: Date.now(), min: -8.64e15, max: 8.64e15 }), window,
    referenceSampleCount: finite(raw.referenceSampleCount, 'referenceSampleCount', { fallback: 180, min: 12, max: 6000, integer: true }),
    maxCatchUpPoints: finite(raw.maxCatchUpPoints, 'maxCatchUpPoints', { fallback: 600, min: 1, max: 2000, integer: true }),
  };
}

export function validateTask(type, raw, registeredRecords) {
  if (!['prepare', 'frame', 'ephemeris', 'calibration', 'groundtrack'].includes(type)) throw new HttpError(422, '未知计算任务类型。');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(422, 'payload 必须是对象。');
  if (raw.perturbationModel !== undefined && !['two-body', 'j2', 'j3'].includes(raw.perturbationModel)) throw new HttpError(422, '摄动模型必须为 two-body、j2 或 j3。');
  const payload = { records: registeredRecords ?? normalizeRecords(raw.records ?? raw.orbits ?? []), perturbationModel: raw.perturbationModel ?? 'two-body' };
  if (type === 'prepare') {
    payload.referenceSampleCount = finite(raw.referenceSampleCount ?? raw.sampleCount, 'referenceSampleCount', { fallback: 1800, min: 12, max: 6000, integer: true });
    payload.elapsedSeconds = finite(raw.elapsedSeconds, 'elapsedSeconds', { fallback: 0 });
  }
  if (type === 'frame' || type === 'groundtrack') {
    payload.elapsedSeconds = finite(raw.elapsedSeconds, 'elapsedSeconds', { fallback: 0 });
    payload.trailCount = finite(raw.trailCount, 'trailCount', { fallback: 130, min: 0, max: 600, integer: true });
    if (raw.groundTrack || type === 'groundtrack') payload.groundTrack = groundOptions(raw.groundTrack ?? raw);
  }
  if (type === 'ephemeris') {
    if (Array.isArray(raw.times)) {
      if (raw.times.length > API_LIMITS.ephemerisStates) throw new HttpError(422, '星历时间点过多。');
      payload.times = raw.times.map((time) => finite(time, 'times'));
    } else {
      const start = finite(raw.startElapsedSeconds ?? raw.elapsedSeconds, 'startElapsedSeconds', { fallback: 0 });
      const count = finite(raw.sampleCount ?? raw.count, 'sampleCount', { fallback: 1, min: 1, max: API_LIMITS.ephemerisStates, integer: true });
      const step = finite(raw.stepSeconds, 'stepSeconds', { fallback: 1, min: 0, max: 1e12 });
      payload.times = Array.from({ length: count }, (_, index) => start + index * step);
    }
    if (payload.records.length * payload.times.length > API_LIMITS.ephemerisStates) throw new HttpError(422, `单次星历最多 ${API_LIMITS.ephemerisStates} 个轨道状态，请分批请求。`);
  }
  if (type === 'calibration') {
    if (!Array.isArray(raw.targets) || raw.targets.length > 64) throw new HttpError(422, '标定目标必须是数组，最多 64 个。');
    payload.targets = raw.targets.map((target, index) => {
      // Keep only vector coordinates, so arbitrary nested input cannot occupy queue memory.
      const vector = {};
      for (const axis of ['x', 'y', 'z']) {
        const value = target?.vector?.[axis];
        vector[axis] = typeof value === 'number' ? value : typeof value === 'string' ? value.slice(0, 100) : undefined;
      }
      return { id: String(target?.id ?? `target-${index + 1}`).slice(0, 160), name: String(target?.name ?? '').slice(0, 200), mode: target?.mode === 'velocity' ? 'velocity' : 'position', vector };
    });
    payload.sampleCount = finite(raw.sampleCount, 'sampleCount', { fallback: 1800, min: 48, max: 6000, integer: true });
  }
  return { type, payload };
}
