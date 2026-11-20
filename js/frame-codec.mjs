/** Lossless Float64 frame transport. This module performs no orbital calculations. */
export const FRAME_MIME = 'application/vnd.orbit.frame+binary';
const MAGIC = 0x3242524f; // ORB2, little endian
const statePaths = [
  ...['positionKm', 'velocityKmS'].flatMap(key => ['x', 'y', 'z'].map(axis => [key, axis])),
  ...['radiusKm', 'trueAnomalyRad', 'meanAnomalyRad', 'eccentricAnomalyRad', 'elapsedSeconds'].map(key => [key]),
  ...['semiMajorAxisKm', 'eccentricity', 'inclinationDeg', 'raanDeg', 'argPeriapsisDeg',
    'trueAnomalyDeg', 'inclinationRad', 'raanRad', 'argPeriapsisRad', 'trueAnomalyRad'].map(key => ['elements', key]),
];
const FULL_MASK = (1 << statePaths.length) - 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeFrame(frame) {
  const values = [];
  const records = frame.records.map(({ state, trail, ...rest }) => {
    const metadata = { ...state };
    for (const key of ['positionKm', 'velocityKmS', 'elements']) if (state[key]) metadata[key] = { ...state[key] };
    let mask = 0;
    statePaths.forEach((path, index) => {
      const target = path.length === 1 ? metadata : metadata[path[0]];
      const key = path.at(-1);
      if (target && Number.isFinite(target[key])) {
        mask |= 1 << index;
        values.push(target[key]);
        delete target[key];
      }
    });
    for (const key of ['positionKm', 'velocityKmS', 'elements']) {
      if (metadata[key] && Object.keys(metadata[key]).length === 0) delete metadata[key];
    }
    for (const point of trail) values.push(point.x, point.y, point.z);
    return [rest, metadata, mask, trail.length];
  });
  // v1 exposes the same history three ways. Carry each segment once and rebuild
  // the derived arrays on receipt without dropping points or changing boundaries.
  const tracks = frame.tracks?.map(({ points, segments, ...track }) => track);
  const header = encoder.encode(JSON.stringify({ version: 1, frame: { ...frame, records, ...(tracks ? { tracks } : {}) } }));
  const offset = Math.ceil((8 + header.byteLength) / 8) * 8;
  const bytes = new Uint8Array(offset + values.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, header.byteLength, true);
  bytes.set(header, 8);
  values.forEach((value, index) => view.setFloat64(offset + index * 8, value, true));
  return bytes;
}

export function decodeFrame(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || view.getUint32(0, true) !== MAGIC) throw new Error('后台帧格式无效。');
  const headerLength = view.getUint32(4, true);
  let cursor = Math.ceil((8 + headerLength) / 8) * 8;
  if (cursor > bytes.byteLength) throw new Error('后台帧已截断。');
  const { version, frame } = JSON.parse(decoder.decode(bytes.subarray(8, 8 + headerLength)));
  if (version !== 1 || !Array.isArray(frame?.records)) throw new Error('不支持的后台帧版本。');
  const number = () => {
    if (cursor + 8 > bytes.byteLength) throw new Error('后台帧数值数据已截断。');
    const result = view.getFloat64(cursor, true);
    cursor += 8;
    return result;
  };
  frame.records = frame.records.map(([rest, state, mask, count]) => {
    if (!Number.isInteger(mask) || mask < 0 || mask > FULL_MASK || !Number.isInteger(count) || count < 0
      || count > (bytes.byteLength - cursor) / 24) throw new Error('后台帧记录格式无效。');
    statePaths.forEach((path, index) => {
      if (!(mask & (1 << index))) return;
      const target = path.length === 1 ? state : (state[path[0]] ??= {});
      target[path.at(-1)] = number();
    });
    const trail = Array.from({ length: count }, () => ({ x: number(), y: number(), z: number() }));
    return { ...rest, state, trail };
  });
  if (cursor !== bytes.byteLength) throw new Error('后台帧数值长度不匹配。');
  if (frame.tracks) frame.tracks = frame.tracks.map(track => {
    const segments = [...track.pastSegments, ...track.currentSegments];
    return { ...track, segments, points: segments.flat() };
  });
  return frame;
}
