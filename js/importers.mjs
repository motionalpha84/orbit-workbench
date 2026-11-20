const ORBIT_TXT_FIELDS = [
  'semiMajorAxisKm',
  'eccentricity',
  'inclinationDeg',
  'raanDeg',
  'argPeriapsisDeg',
  'trueAnomalyDeg',
];

function isNumericLine(value) {
  if (!value) return false;
  return Number.isFinite(Number(value));
}

// Legacy 轨道六要素 layout: a name line, then one element value per line ('#' lines are comments).
function parseLegacyOrbitText(text) {
  const rows = String(text)
    .split(/\r?\n/)
    .map((raw, index) => ({ lineNumber: index + 1, value: raw.trim() }))
    .filter((row) => row.value.length > 0 && !row.value.startsWith('#'));

  if (rows.length === 0) {
    throw new Error('TXT 文件为空。');
  }

  const records = [];
  let index = 0;

  while (index < rows.length) {
    const nameRow = rows[index];
    if (isNumericLine(nameRow.value)) {
      throw new Error(`第 ${nameRow.lineNumber} 行应为轨道名称。`);
    }
    index += 1;

    const values = [];
    while (index < rows.length && values.length < ORBIT_TXT_FIELDS.length) {
      const row = rows[index];
      if (values.length >= ORBIT_TXT_FIELDS.length - 1 && !isNumericLine(row.value)) break;
      if (!isNumericLine(row.value)) {
        throw new Error(`第 ${row.lineNumber} 行应为 ${ORBIT_TXT_FIELDS[values.length]} 的数值。`);
      }
      values.push(Number(row.value));
      index += 1;
    }

    if (values.length === ORBIT_TXT_FIELDS.length - 1) values.push(0);
    if (values.length !== ORBIT_TXT_FIELDS.length) {
      throw new Error(`轨道 ${nameRow.value} 缺少轨道六要素数值。`);
    }

    records.push(Object.fromEntries([
      ['name', nameRow.value],
      ...ORBIT_TXT_FIELDS.map((field, valueIndex) => [field, values[valueIndex]]),
    ]));
  }

  return records;
}

// Shared by the line-per-record formats: '#' starts a comment, comma or tab separated columns
// win over whitespace so names may contain spaces.
function dataRows(text) {
  return String(text)
    .split(/\r?\n/)
    .map((raw, index) => ({ lineNumber: index + 1, value: raw.trim() }))
    .filter((row) => row.value.length > 0);
}

function splitColumns(value) {
  return (/[,\t]/.test(value) ? value.split(/[,\t]/) : value.split(/\s+/)).map((cell) => cell.trim()).filter((cell, index, all) => cell.length > 0 || index < all.length - 1);
}

// '# KEY: value' / '# KEY = value' directives; keys compare case-insensitively.
function directive(value, keys) {
  const match = /^#\s*([^:=]+?)\s*[:=]\s*(.*)$/.exec(value);
  if (!match || !keys.includes(match[1].trim().toUpperCase())) return null;
  return match[2].trim();
}

const GROUP_KEYS = ['GROUP', '组名', '轨道组'];
const NAME_KEYS = ['NAME', '名称', '轨迹名称'];
const GROUP_COLUMN_LABELS = ['a', 'e', 'i', 'Ω', 'ω', 'ν'];

// One orbit per line — `name a e i Ω ω ν` (ν may be omitted → 0), shared by 轨道六要素 and
// 统一六要素组. `# GROUP: 名称` names the group; a first line whose second column is not a
// number is a header.
function parseElementLines(text) {
  const rows = dataRows(text);
  let groupName = '';
  const records = [];
  let headerAllowed = true;
  for (const row of rows) {
    if (row.value.startsWith('#')) {
      const group = directive(row.value, GROUP_KEYS);
      if (group !== null) groupName = group;
      continue;
    }
    const cells = splitColumns(row.value);
    if (headerAllowed && cells.length > 1 && !isNumericLine(cells[1])) { headerAllowed = false; continue; }
    headerAllowed = false;
    if (cells.length !== 6 && cells.length !== 7) {
      throw new Error(`第 ${row.lineNumber} 行应为「名称 a e i Ω ω ν」共 7 列（ν 可省略），实际 ${cells.length} 列。`);
    }
    const [name, ...numbers] = cells;
    if (!name || isNumericLine(name)) throw new Error(`第 ${row.lineNumber} 行第 1 列应为轨道名称。`);
    const values = numbers.map((cell, column) => {
      if (!isNumericLine(cell)) throw new Error(`第 ${row.lineNumber} 行第 ${column + 2} 列（${GROUP_COLUMN_LABELS[column]}）不是有效数值。`);
      return Number(cell);
    });
    if (values.length === ORBIT_TXT_FIELDS.length - 1) values.push(0);
    records.push(Object.fromEntries([['name', name], ...ORBIT_TXT_FIELDS.map((field, column) => [field, values[column]])]));
  }
  return { groupName, records };
}

/**
 * 轨道六要素 TXT: one orbit per line with an optional `# GROUP: 名称`, the same format as
 * 统一六要素组. Files in the earlier layout (a name line, then one value per line) are still
 * read: the first data line holding fewer than six columns selects it.
 */
export function parseOrbitFile(text) {
  const rows = dataRows(text);
  const first = rows.find((row) => !row.value.startsWith('#'));
  if (!first) throw new Error('TXT 文件为空。');
  if (splitColumns(first.value).length < 6) {
    const groupName = rows.map((row) => (row.value.startsWith('#') ? directive(row.value, GROUP_KEYS) : null)).filter((name) => name !== null).pop() ?? '';
    return { groupName, records: parseLegacyOrbitText(text) };
  }
  const group = parseElementLines(text);
  if (group.records.length === 0) throw new Error('TXT 文件中没有轨道数据。');
  return group;
}

/** The records of a 轨道六要素 TXT (see parseOrbitFile). */
export function parseOrbitText(text) {
  return parseOrbitFile(text).records;
}

/** 统一六要素组 TXT: the 轨道六要素 line format; `# GROUP: 名称` names the group. */
export function parseElementGroupText(text) {
  const group = parseElementLines(text);
  if (group.records.length === 0) throw new Error('六要素组文件中没有轨道数据。');
  return group;
}

const MAX_TRAJECTORY_SAMPLES = 100000;
const UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?$/i;

// UTC stamps without a zone are read as UTC, matching the simulation clock.
export function parseTrajectoryTime(cell) {
  if (isNumericLine(cell)) return { kind: 'elapsed', value: Number(cell) };
  const match = UTC_PATTERN.exec(cell);
  if (!match) return null;
  const ms = Date.parse(match[7] ? cell.replace(' ', 'T') : `${cell.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? { kind: 'utc', value: ms } : null;
}

/**
 * 轨迹 TXT: one sample per line — `t x y z` (km) or `t x y z vx vy vz` (km, km/s). `t` is seconds
 * from the simulation start or an ISO 8601 UTC stamp, strictly increasing. `# NAME: 名称` starts
 * (or names) a trajectory, so one file may hold several. The frame is chosen on import.
 */
export function parseTrajectoryText(text) {
  const rows = dataRows(text);
  const trajectories = [];
  let current = null;
  let total = 0;
  const finish = () => {
    if (!current || current.samples.length === 0) return;
    if (current.samples.length < 2) throw new Error(`轨迹 ${current.name} 至少需要 2 个时刻的位置矢量。`);
    trajectories.push(current);
  };
  const start = (name) => {
    finish();
    current = { name, timeKind: null, hasVelocity: null, samples: [], firstLine: 0, headerAllowed: true };
  };
  for (const row of rows) {
    if (row.value.startsWith('#')) {
      const name = directive(row.value, NAME_KEYS);
      if (name === null) continue;
      if (current && current.samples.length === 0) current.name = name;
      else start(name);
      continue;
    }
    if (!current) start('');
    const cells = splitColumns(row.value);
    // whitespace-separated 'YYYY-MM-DD hh:mm:ss' stamps arrive as two cells
    if (/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) && /^\d{2}:\d{2}/.test(cells[1] ?? '')) cells.splice(0, 2, `${cells[0]} ${cells[1]}`);
    if (current.headerAllowed && cells.length > 1 && !isNumericLine(cells[1])) { current.headerAllowed = false; continue; }
    current.headerAllowed = false;
    if (cells.length !== 4 && cells.length !== 7) {
      throw new Error(`第 ${row.lineNumber} 行应为「t x y z」4 列或「t x y z vx vy vz」7 列，实际 ${cells.length} 列。`);
    }
    const time = parseTrajectoryTime(cells[0]);
    if (!time) throw new Error(`第 ${row.lineNumber} 行的时间「${cells[0]}」应为秒数或 ISO 8601 UTC 时间。`);
    if (current.timeKind && current.timeKind !== time.kind) throw new Error(`第 ${row.lineNumber} 行的时间格式与前文不一致（同一轨迹须统一使用秒数或 UTC）。`);
    const hasVelocity = cells.length === 7;
    if (current.hasVelocity !== null && current.hasVelocity !== hasVelocity) throw new Error(`第 ${row.lineNumber} 行的列数与前文不一致（同一轨迹须统一是否包含速度）。`);
    const numbers = cells.slice(1).map((cell, column) => {
      if (!isNumericLine(cell)) throw new Error(`第 ${row.lineNumber} 行第 ${column + 2} 列不是有效数值。`);
      return Number(cell);
    });
    const previous = current.samples[current.samples.length - 1];
    const seconds = time.kind === 'utc' ? time.value / 1000 : time.value;
    if (previous && seconds <= previous.seconds) throw new Error(`第 ${row.lineNumber} 行的时间未严格递增。`);
    if (Math.hypot(numbers[0], numbers[1], numbers[2]) === 0) throw new Error(`第 ${row.lineNumber} 行的位置矢量为零。`);
    current.timeKind = time.kind;
    current.hasVelocity = hasVelocity;
    const sample = { seconds, positionKm: { x: numbers[0], y: numbers[1], z: numbers[2] } };
    if (hasVelocity) sample.velocityKmS = { x: numbers[3], y: numbers[4], z: numbers[5] };
    current.samples.push(sample);
    total += 1;
    if (total > MAX_TRAJECTORY_SAMPLES) throw new Error(`轨迹采样点超过 ${MAX_TRAJECTORY_SAMPLES} 个，请抽稀后再导入。`);
  }
  finish();
  if (trajectories.length === 0) throw new Error('轨迹文件中没有位置矢量数据。');
  // samples carry time relative to their first row; the origin keeps the absolute reference
  return trajectories.map((trajectory, index) => {
    const t0 = trajectory.samples[0].seconds;
    return {
      name: trajectory.name || `轨迹 ${index + 1}`,
      timeOrigin: trajectory.timeKind === 'utc' ? { kind: 'utc', utcMs: t0 * 1000 } : { kind: 'elapsed', elapsedSeconds: t0 },
      hasVelocity: trajectory.hasVelocity,
      samples: trajectory.samples.map(({ seconds, positionKm, velocityKmS }) => ({ t: seconds - t0, positionKm, ...(velocityKmS ? { velocityKmS } : {}) })),
    };
  });
}
