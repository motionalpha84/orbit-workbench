// Display-only orbit classification for roster and HUD badges (approved V2.2 rule table).
// Altitudes are measured above the equatorial radius; nothing here feeds propagation.

export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const GEO_SMA_KM = 42164;
const GEO_SMA_TOLERANCE_KM = 200;

export const ORBIT_CLASSES = {
  LEO: { accent: '#8FE3D3', zh: '低地球轨道', en: 'Low Earth orbit' },
  MEO: { accent: '#A9B6F5', zh: '中地球轨道', en: 'Medium Earth orbit' },
  GEO: { accent: '#DCEB72', zh: '地球静止轨道', en: 'Geostationary orbit' },
  IGSO: { accent: '#F5B74A', zh: '倾斜地球同步轨道', en: 'Inclined geosynchronous orbit' },
  Molniya: { accent: '#FF7A45', zh: '闪电轨道', en: 'Molniya orbit' },
  HEO: { accent: '#FF9A7A', zh: '大椭圆轨道', en: 'Highly elliptical orbit' },
};

/**
 * GEO: a = 42164 ± 200 km, e < 0.01, i < 5° · IGSO: same a band, i ≥ 5°
 * Molniya: e ≥ 0.6, i = 63.4 ± 3°, T = 11.5–12.5 h · HEO: any other e ≥ 0.25
 * LEO: apogee altitude < 2000 km · everything else: MEO
 */
export function classifyOrbit({ semiMajorAxisKm, eccentricity, inclinationDeg, periodSeconds } = {}) {
  const a = Number(semiMajorAxisKm);
  const e = Number(eccentricity);
  const i = Number(inclinationDeg);
  if (![a, e, i].every(Number.isFinite)) return null;
  const period = Number.isFinite(Number(periodSeconds)) ? Number(periodSeconds) : null;
  const hours = period === null ? null : period / 3600;
  const geoBand = Math.abs(a - GEO_SMA_KM) <= GEO_SMA_TOLERANCE_KM;
  if (geoBand && e < 0.01 && i < 5) return 'GEO';
  if (geoBand && i >= 5) return 'IGSO';
  if (e >= 0.6 && Math.abs(i - 63.4) <= 3 && hours !== null && hours >= 11.5 && hours <= 12.5) return 'Molniya';
  if (e >= 0.25) return 'HEO';
  if (a * (1 + e) - EARTH_EQUATORIAL_RADIUS_KM < 2000) return 'LEO';
  return 'MEO';
}

/** Classify an app orbit record ({ orbit: { elements, periodSeconds } }). */
export function classifyOrbitRecord(record) {
  const orbit = record?.orbit;
  if (!orbit?.elements) return null;
  return classifyOrbit({ ...orbit.elements, periodSeconds: orbit.periodSeconds });
}
