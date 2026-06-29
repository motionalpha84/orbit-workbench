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

export function parseOrbitText(text) {
  const rows = String(text)
    .split(/\r?\n/)
    .map((raw, index) => ({ lineNumber: index + 1, value: raw.trim() }))
    .filter((row) => row.value.length > 0);

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
