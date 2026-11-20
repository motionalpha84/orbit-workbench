// Preserve an immutable request identity between frames. Only changed source
// records are serialized; the transport can reuse its server-side dataset.
const keys = ['semiMajorAxisKm', 'eccentricity', 'inclinationDeg', 'raanDeg', 'argPeriapsisDeg', 'trueAnomalyDeg'];
export class WireRecordCache {
  constructor() { this.entries = new Map(); this.records = []; }
  get(records) {
    let changed = records.length !== this.records.length;
    const next = records.map((record, index) => {
      const elements = record.orbit?.elements ?? record.elements;
      const values = [record.id, record.name, record.color, record.visible, ...keys.map((key) => elements[key])];
      let entry = this.entries.get(record.id);
      if (!entry || values.some((value, i) => value !== entry.values[i])) {
        entry = { values, wire: { id: record.id, name: record.name, color: record.color, visible: record.visible, elements: { name: record.name, ...Object.fromEntries(keys.map((key) => [key, elements[key]])) } } };
        this.entries.set(record.id, entry);
      }
      if (entry.wire !== this.records[index]) changed = true;
      return entry.wire;
    });
    if (changed) {
      this.records = next;
      const present = new Set(records.map((record) => record.id));
      for (const id of this.entries.keys()) if (!present.has(id)) this.entries.delete(id);
    }
    return this.records;
  }
}
