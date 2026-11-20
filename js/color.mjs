// V2.2 Firefly palette: mid-tone colours that stay legible on the light stage and the map.
export const DEFAULT_ORBIT_COLORS = [
  '#2fb5a2',
  '#f07a3c',
  '#6a7fd8',
  '#94bc3a',
  '#d9a520',
  '#d2608a',
  '#3a92c8',
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

// Light-theme display colour: very pale orbit colours (luminance > 0.6, e.g. v2.1's #e2e8f0)
// are pulled toward slate so they stay visible on the pale stage and map. Stored colours,
// lists and exports keep their original value; only drawing uses this.
export function displayColorOnLight(value) {
  const hex = normalizeHexColor(value);
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance <= 0.6) return hex;
  const mix = Math.min(0.6, (luminance - 0.6) * 1.5 + 0.3);
  const slate = [0x22, 0x32, 0x3a];
  return rgbToHex(...[r, g, b].map((channel, index) => channel + (slate[index] - channel) * mix));
}
