export const DEFAULT_ORBIT_COLORS = [
  '#616c8c',
  '#568c87',
  '#7cb388',
  '#f2de79',
  '#d95f18',
];

function clampChannel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function toHexChannel(value) {
  return clampChannel(value).toString(16).padStart(2, '0');
}

export function rgbToHex(r, g, b) {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
}

export function normalizeHexColor(value, fallback = DEFAULT_ORBIT_COLORS[0]) {
  const raw = String(value ?? '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return fallback;
}

export function hexToRgb(value) {
  const hex = normalizeHexColor(value).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function nextOrbitColor(index) {
  return DEFAULT_ORBIT_COLORS[Math.abs(Number(index) || 0) % DEFAULT_ORBIT_COLORS.length];
}
