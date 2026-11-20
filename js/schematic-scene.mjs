// V2.2 "Firefly" orbital schematic: a 2D-canvas renderer that reproduces the approved prototype —
// grid paper, an orthographic white globe with night-side hatching and Natural Earth coastlines,
// a radial √ non-linear scale (LEO and GEO legible together), dashed reference orbits, fading
// trails, diamond markers with leader-line callouts, and a direct yaw / pitch drag with damped
// zoom and view easing. It draws only backend-computed data and exposes the same interface the
// app used with the WebGL OrbitScene.
import { EARTH_RADIUS_KM } from './orbit.mjs';
import { greenwichSiderealAngleAt } from './groundtrack.mjs';
import { displayColorOnLight } from './color.mjs';

const RE = EARTH_RADIUS_KM;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const EARTH_RATE = 7.2921159e-5; // rad/s, for per-sample trail rotation in ECEF
const ECLIPTIC_OBLIQUITY = 23.439 * D2R;
const PLANE_RADIUS = 3.9;
const CAM0 = { yaw: -0.62, pitch: 0.36, zoom: 1 };
const MINI_ZOOM = 1.25;
const INK_MS = 2600;
const FH = '"Chakra Petch","Bahnschrift","Microsoft YaHei",sans-serif';
const FM = '"JetBrains Mono",Consolas,"SFMono-Regular",monospace';
const INK = '#22323A';
const LAND_MASK_SRC = './assets/maps/earth-land-mask-4096.png';
const GLOBE_MAX_PX = 1400;  // globe raster cap in device pixels
const GLOBE_DRAFT_PX = 640; // while the camera moves, re-projection runs at this size

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotZ = (p, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
};
const finiteVector = (v) => v && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y)) && Number.isFinite(Number(v.z));
const toArray = (v) => [Number(v.x), Number(v.y), Number(v.z)];

// cubic-bezier(.16, 1, .3, 1) — the app's high-initial-velocity ease
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  return (x) => {
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= (sx(t) - x) / d;
    }
    t = clamp(t, 0, 1);
    return ((ay * t + by) * t + cy) * t;
  };
}
const EASE = bezier(0.16, 1, 0.3, 1);

/** Radial √-style compression: Earth radius → 1, GEO ≈ 3.3, keeps direction. */
export function schematicRadius(rKm) {
  return 1 + 0.9 * Math.max(0, rKm / RE - 1) ** 0.55;
}
function vis(p) {
  const r = Math.hypot(p[0], p[1], p[2]) || 1;
  const f = schematicRadius(r) / r;
  return [p[0] * f, p[1] * f, p[2] * f];
}

/** Low-precision solar direction (ECI unit vector), adequate for a day / night terminator. */
export function sunDirectionEci(utcMs) {
  const d = utcMs / 86400000 + 2440587.5 - 2451545;
  const L = (280.46 + 0.9856474 * d) * D2R;
  const g = (357.528 + 0.9856003 * d) * D2R;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  return [Math.cos(lambda), Math.cos(ECLIPTIC_OBLIQUITY) * Math.sin(lambda), Math.sin(ECLIPTIC_OBLIQUITY) * Math.sin(lambda)];
}

// The worker samples a trail over this span ending at the frame time (server/worker.mjs),
// so each sample's epoch can be recovered for an exact ECEF rotation.
function trailSpanSeconds(periodSeconds) {
  return Math.min(periodSeconds * 0.22, Math.max(420, periodSeconds * 0.1));
}

/* ---------- land mask: 0 ocean · 1 land · 2 coastline, equirectangular 4096 × 2048 ----------
   Coastlines are traced at every mip level (4096 → 512) so the globe can sample the level whose
   texel is about one screen pixel: the coast then stays a crisp one-pixel line at any zoom. */
let landMask = null;
let landMaskLoading = null;
function traceCoast(land, W, H) {
  const out = land.slice();
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!land[i]) continue;
      const l = y * W + ((x + W - 1) % W);
      const r = y * W + ((x + 1) % W);
      if (!land[l] || !land[r] || (y > 0 && !land[i - W]) || (y < H - 1 && !land[i + W])) out[i] = 2;
    }
  }
  return { data: out, W, H };
}
function halveLand(land, W, H) {
  const w = W >> 1; const h = H >> 1; const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = 2 * y * W + 2 * x;
      out[y * w + x] = land[i] + land[i + 1] + land[i + W] + land[i + W + 1] >= 2 ? 1 : 0;
    }
  }
  return out;
}
function loadLandMask(onReady) {
  if (landMask) return;
  if (!landMaskLoading && typeof Image !== 'undefined') {
    landMaskLoading = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        let W = image.naturalWidth;
        let H = image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, W, H).data;
        let land = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i += 1) land[i] = pixels[i * 4] > 127 ? 1 : 0;
        const levels = [];
        while (W >= 512) {
          levels.push(traceCoast(land, W, H));
          land = halveLand(land, W, H);
          W >>= 1; H >>= 1;
        }
        landMask = { levels };
        resolve(landMask);
      };
      image.onerror = () => resolve(null);
      image.src = LAND_MASK_SRC;
    });
  }
  landMaskLoading?.then((mask) => { if (mask) onReady(); });
}

// globe palette as little-endian RGBA words: ocean white, land #D8E6E3, coastline #627276
const GLOBE_COLORS = new Uint32Array([0xFFFFFFFF, 0xFFE3E6D8, 0xFF767262]);

/* ---------- shared scene data: the deck renderer owns it, the mini viewport reads it ---------- */
function createData() {
  return {
    orbits: [],
    computed: new Map(),
    selected: new Set(),
    overlays: { axes: true, ecliptic: true, radius: true, reference: true },
    frame: 'ECI',
    epochMs: Date.now(),
    elapsed: 0,
    markers: [],
    revision: 0,
  };
}

export class SchematicScene {
  constructor(canvas, { mini = false, source = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d') ?? null;
    this.mini = mini;
    this.data = source ? source.data : createData();
    this.linked = [];
    if (source) source.linked.push(this);
    const zoom = mini ? MINI_ZOOM : CAM0.zoom;
    this.cam = { ...CAM0, zoom };
    this.camTarget = { ...CAM0, zoom };
    this.grid = null;
    this.gridKey = '';
    this.globe = null;
    this.globeKey = '';
    this.mouse = null;
    this.drag = null;
    this.hoverId = null;
    this.hoverCallback = null;
    this.clickCallback = null;
    this.plotStart = 0;
    this.plotDone = mini;
    this.screenPoints = new Map();
    this.refCache = new Map();
    this.lastRender = performance.now();
    this.plotterEl = mini ? null : document.getElementById('scene-plotter');
    this.scaleBarEl = mini ? null : document.getElementById('scene-scale-bar');
    this.bindPointer();
    loadLandMask(() => { this.globeKey = ''; this.render(); });
  }

  /* ---------- data in (same calls the app made on the WebGL scene) ---------- */
  syncOrbits(orbits) {
    this.data.orbits = orbits;
    this.data.revision += 1;
  }

  setComputedFrame(frame) {
    this.data.computed = new Map((frame?.records ?? []).map((record) => [record.id, record]));
    if (Number.isFinite(frame?.elapsedSeconds)) this.data.elapsed = frame.elapsedSeconds;
  }

  setSelectedOrbits(ids = []) {
    this.data.selected = new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);
  }

  setSelectedOrbit(id) { this.setSelectedOrbits(id ? [id] : []); }

  setOverlayVisibility({ axes, ecliptic, radius, reference } = {}) {
    const overlays = this.data.overlays;
    if (typeof axes === 'boolean') overlays.axes = axes;
    if (typeof ecliptic === 'boolean') overlays.ecliptic = ecliptic;
    if (typeof radius === 'boolean') overlays.radius = radius;
    if (typeof reference === 'boolean') overlays.reference = reference;
  }

  setFrame(frame) { this.data.frame = frame === 'ECEF' ? 'ECEF' : 'ECI'; }

  setEpoch(utcMs) { if (Number.isFinite(utcMs)) this.data.epochMs = utcMs; }

  setCalibrationMarkers(markers = []) {
    this.data.markers = (Array.isArray(markers) ? markers : []).filter((marker) => finiteVector(marker?.positionKm));
  }

  setPerformanceBudget() { /* drawing density adapts to the orbit count instead */ }

  setOrbitHoverCallback(callback) { this.hoverCallback = callback; }

  setOrbitClickCallback(callback) { this.clickCallback = callback; }

  setView(view) {
    const target = this.camTarget;
    if (view === 'front') Object.assign(target, { yaw: 0, pitch: 0 });
    else if (view === 'top') Object.assign(target, { yaw: 0, pitch: Math.PI / 2 - 0.001 });
    else Object.assign(target, { yaw: CAM0.yaw, pitch: CAM0.pitch, zoom: this.mini ? MINI_ZOOM : CAM0.zoom });
    // ease the short way round
    const delta = ((target.yaw - this.cam.yaw) % TAU + TAU + Math.PI) % TAU - Math.PI;
    target.yaw = this.cam.yaw + delta;
  }

  update(orbits, elapsedSeconds) {
    if (orbits && orbits !== this.data.orbits) this.syncOrbits(orbits);
    if (Number.isFinite(elapsedSeconds)) this.data.elapsed = elapsedSeconds;
    this.render();
    for (const scene of this.linked) scene.render();
  }

  resize() { this.render(); }

  capturePng() {
    this.render(true);
    const flat = document.createElement('canvas');
    flat.width = this.canvas.width;
    flat.height = this.canvas.height;
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#F3F8F7';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(this.canvas, 0, 0);
    return flat.toDataURL('image/png');
  }

  getPerformanceStats() {
    return { mode: 'schematic', orbitCount: this.data.orbits.length };
  }

  /* ---------- pointer: direct yaw / pitch drag, damped wheel zoom, hover + click ---------- */
  bindPointer() {
    const canvas = this.canvas;
    if (!canvas?.addEventListener) return;
    canvas.addEventListener('pointerdown', (event) => {
      try { canvas.setPointerCapture(event.pointerId); } catch { /* untracked pointer */ }
      this.drag = { x: event.clientX, y: event.clientY, moved: 0 };
      canvas.classList.add('drag');
      this.setHover(null);
    });
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY };
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.cam.yaw += dx * 0.007;
      this.camTarget.yaw = this.cam.yaw;
      this.cam.pitch = clamp(this.cam.pitch + dy * 0.007, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      this.camTarget.pitch = this.cam.pitch;
    });
    const end = () => {
      if (this.drag && this.drag.moved < 4 && this.hoverId && this.clickCallback) this.clickCallback(this.hoverId);
      this.drag = null;
      canvas.classList.remove('drag');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { this.mouse = null; this.setHover(null); });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.camTarget.zoom = clamp(this.camTarget.zoom * Math.exp(-event.deltaY * 0.0012), 0.45, 4);
    }, { passive: false });
  }

  setHover(id, payload = null) {
    const changed = id !== this.hoverId;
    this.hoverId = id;
    if (this.canvas) this.canvas.style.cursor = id ? 'pointer' : '';
    if (!this.hoverCallback) return;
    if (id) this.hoverCallback(payload);
    else if (changed) this.hoverCallback(null);
  }

  /* ---------- projection ---------- */
  setupProjection(W, H) {
    const c = this.cam;
    const cy = Math.cos(c.yaw); const sy = Math.sin(c.yaw); const cp = Math.cos(c.pitch); const sp = Math.sin(c.pitch);
    this.pj = {
      cx: W / 2, cy: H / 2 + 8, K: c.zoom * Math.min(W, H) * 0.112,
      Sx: [cy, -sy, 0], Up: [sy * sp, cy * sp, cp], Dv: [-sy * cp, -cy * cp, sp],
    };
  }

  // [x, y, depth, hiddenBehindEarth]
  project(v) {
    const pj = this.pj;
    const a = dot(v, pj.Sx); const b = dot(v, pj.Up); const d = dot(v, pj.Dv);
    return [pj.cx + a * pj.K, pj.cy - b * pj.K, d, d < 0 && a * a + b * b < 1];
  }

  /* ---------- background: grid paper, centre cross, ruler ticks, registration marks ---------- */
  buildGrid(W, H, dpr) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const x = canvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2; const cy = H / 2 + 8;
    const lines = (step, color) => {
      x.strokeStyle = color; x.lineWidth = 1; x.beginPath();
      for (let gx = cx % step; gx < W; gx += step) { x.moveTo(Math.round(gx) + 0.5, 0); x.lineTo(Math.round(gx) + 0.5, H); }
      for (let gy = cy % step; gy < H; gy += step) { x.moveTo(0, Math.round(gy) + 0.5); x.lineTo(W, Math.round(gy) + 0.5); }
      x.stroke();
    };
    lines(12, 'rgba(34,60,64,.04)');
    lines(60, 'rgba(34,60,64,.085)');
    x.setLineDash([2, 5]); x.strokeStyle = 'rgba(34,60,64,.22)'; x.beginPath();
    x.moveTo(0, cy + 0.5); x.lineTo(W, cy + 0.5); x.moveTo(cx + 0.5, 0); x.lineTo(cx + 0.5, H); x.stroke(); x.setLineDash([]);
    x.strokeStyle = 'rgba(34,60,64,.4)'; x.beginPath();
    for (let gx = cx % 12, k = Math.round(-cx / 12); gx < W; gx += 12, k += 1) { const L = k % 5 === 0 ? 7 : 3; x.moveTo(gx, 0); x.lineTo(gx, L); x.moveTo(gx, H); x.lineTo(gx, H - L); }
    for (let gy = cy % 12, k = Math.round(-cy / 12); gy < H; gy += 12, k += 1) { const L = k % 5 === 0 ? 7 : 3; x.moveTo(0, gy); x.lineTo(L, gy); x.moveTo(W, gy); x.lineTo(W - L, gy); }
    x.stroke();
    x.strokeStyle = 'rgba(34,60,64,.5)'; x.lineWidth = 1;
    for (const [px, py] of [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]]) {
      x.beginPath(); x.arc(px, py, 6, 0, TAU); x.moveTo(px - 11, py); x.lineTo(px + 11, py); x.moveTo(px, py - 11); x.lineTo(px, py + 11); x.stroke();
    }
    return canvas;
  }

  /* ---------- polyline with dashed / faded runs where it passes behind the globe ---------- */
  strokeRuns(ctx, pts, color, width, alpha, dash, hiddenAlpha) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    let run = [pts[0]]; let hidden = pts[0][3];
    const flush = () => {
      if (run.length < 2) return;
      if (hidden) { if (!hiddenAlpha) return; ctx.setLineDash([3, 4]); ctx.globalAlpha = hiddenAlpha; }
      else { ctx.setLineDash(dash || []); ctx.globalAlpha = alpha; }
      ctx.beginPath(); ctx.moveTo(run[0][0], run[0][1]);
      for (let k = 1; k < run.length; k += 1) ctx.lineTo(run[k][0], run[k][1]);
      ctx.stroke();
    };
    for (let k = 1; k < pts.length; k += 1) {
      const p = pts[k];
      if (p[3] !== hidden) { run.push(p); flush(); run = [p]; hidden = p[3]; } else run.push(p);
    }
    flush(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  /* ---------- globe: Natural Earth land in the prototype palette, hatched night side ----------
     Each globe pixel's Earth-fixed longitude is (view longitude − Earth rotation), so the view
     longitude / latitude per pixel are cached per camera and Earth rotation only shifts a lookup.
     While the camera moves the cache is rebuilt at draft size; it sharpens when the camera rests. */
  rasterGlobe(K, rotE) {
    const mask = landMask;
    if (!mask) return null;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const full = Math.max(16, Math.min(GLOBE_MAX_PX, Math.round(2 * K * dpr)));
    const pj = this.pj;
    const camKey = `${full}|${[...pj.Sx, ...pj.Up].map((v) => v.toFixed(5)).join()}`;
    const moving = camKey !== this.globeCamKey;
    this.globeCamKey = camKey;
    const D = moving ? Math.min(full, GLOBE_DRAFT_PX) : full;
    // texel ≈ screen pixel at the disc centre: the level width should be about π · D
    const level = mask.levels.find((l, i) => i === mask.levels.length - 1 || mask.levels[i + 1].W < Math.PI * D * 0.9);
    const { data, W } = level;
    // rotation steps under half a pixel at the rim would not change the image
    const step = 1 / D;
    const rotKey = Math.round(rotE / step);
    const key = `${D}|${camKey}|${rotKey}`;
    if (key === this.globeKey && this.globe) return this.globe;

    const geoKey = `${D}|${camKey}`;
    if (geoKey !== this.globeGeoKey) this.buildGlobeGeometry(D, level, pj, geoKey);
    if (!this.globe || this.globe.width !== D) {
      this.globe = document.createElement('canvas');
      this.globe.width = D; this.globe.height = D;
      this.globeImage = this.globe.getContext('2d').createImageData(D, D);
      this.globeWords = new Uint32Array(this.globeImage.data.buffer);
    }
    const words = this.globeWords;
    const { lonPx, rowBase, inside } = this.globeGeo;
    words.fill(0);
    let shift = (rotKey * step * W) / TAU;
    shift -= Math.floor(shift / W) * W;
    for (let k = 0; k < inside.length; k += 1) {
      const o = inside[k];
      let x = lonPx[k] - shift;
      if (x < 0) x += W;
      words[o] = GLOBE_COLORS[data[rowBase[k] + (x | 0)]];
    }
    this.globe.getContext('2d').putImageData(this.globeImage, 0, 0);
    this.globeKey = key;
    return this.globe;
  }

  buildGlobeGeometry(D, level, pj, geoKey) {
    const { W, H } = level;
    const [s0, s1, s2] = pj.Sx; const [u0, u1, u2] = pj.Up; const [d0, d1, d2] = pj.Dv;
    const lonScale = W / TAU; const latScale = H / Math.PI;
    const capacity = Math.ceil(D * D * 0.8) + 4 * D;
    const inside = new Int32Array(capacity);
    const lonPx = new Float32Array(capacity);
    const rowBase = new Int32Array(capacity);
    let n = 0;
    for (let j = 0; j < D; j += 1) {
      const b = 1 - (2 * j + 1) / D;
      for (let i = 0; i < D; i += 1) {
        const a = (2 * i + 1) / D - 1;
        const r2 = a * a + b * b;
        if (r2 > 1) continue;
        const d = Math.sqrt(1 - r2);
        const wx = a * s0 + b * u0 + d * d0;
        const wy = a * s1 + b * u1 + d * d1;
        const wz = a * s2 + b * u2 + d * d2;
        let px = (Math.atan2(wy, wx) + Math.PI) * lonScale;
        if (px >= W) px -= W;
        let py = ((Math.PI / 2 - Math.asin(wz < -1 ? -1 : wz > 1 ? 1 : wz)) * latScale) | 0;
        if (py >= H) py = H - 1;
        inside[n] = j * D + i; lonPx[n] = px; rowBase[n] = py * W;
        n += 1;
      }
    }
    this.globeGeo = { inside: inside.subarray(0, n), lonPx: lonPx.subarray(0, n), rowBase: rowBase.subarray(0, n) };
    this.globeGeoKey = geoKey;
  }

  drawEarth(ctx, rotE, sun, inkProgress) {
    const { cx, cy, K } = this.pj;
    const globe = this.rasterGlobe(K, rotE);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, K, 0, TAU); ctx.clip();
    if (globe) { ctx.imageSmoothingEnabled = true; ctx.drawImage(globe, cx - K, cy - K, 2 * K, 2 * K); }
    else { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(cx - K, cy - K, 2 * K, 2 * K); }
    // night side: the unlit hemisphere bounded by the terminator, hatched
    const pj = this.pj;
    const sd = dot(sun, pj.Dv);
    if (sd < 0.999) {
      ctx.beginPath();
      if (sd > -0.999) {
        let u = [sun[1] * pj.Dv[2] - sun[2] * pj.Dv[1], sun[2] * pj.Dv[0] - sun[0] * pj.Dv[2], sun[0] * pj.Dv[1] - sun[1] * pj.Dv[0]];
        const ul = Math.hypot(...u) || 1; u = u.map((v) => v / ul);
        let w = [sun[1] * u[2] - sun[2] * u[1], sun[2] * u[0] - sun[0] * u[2], sun[0] * u[1] - sun[1] * u[0]];
        if (dot(w, pj.Dv) < 0) w = w.map((v) => -v);
        for (let k = 0; k <= 48; k += 1) {
          const f = (k / 48) * Math.PI;
          const q = this.project([u[0] * Math.cos(f) + w[0] * Math.sin(f), u[1] * Math.cos(f) + w[1] * Math.sin(f), u[2] * Math.cos(f) + w[2] * Math.sin(f)]);
          if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
        }
        const bu = Math.atan2(dot(u, pj.Up), dot(u, pj.Sx));
        const bm = bu + 1.5 * Math.PI;
        const limb = [pj.Sx[0] * Math.cos(bm) + pj.Up[0] * Math.sin(bm), pj.Sx[1] * Math.cos(bm) + pj.Up[1] * Math.sin(bm), pj.Up[2] * Math.sin(bm)];
        const dir = dot(limb, sun) < 0 ? 1 : -1;
        for (let k = 0; k <= 48; k += 1) { const ang = bu + Math.PI + (dir * k / 48) * Math.PI; ctx.lineTo(cx + K * Math.cos(ang), cy - K * Math.sin(ang)); }
        ctx.closePath();
      } else ctx.arc(cx, cy, K, 0, TAU);
      ctx.clip();
      ctx.fillStyle = 'rgba(34,60,64,.06)'; ctx.fillRect(cx - K, cy - K, 2 * K, 2 * K);
      ctx.strokeStyle = 'rgba(34,60,64,.2)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let d = -2 * K; d < 2 * K; d += 5) { ctx.moveTo(cx + d - K, cy - K); ctx.lineTo(cx + d + K, cy + K); }
      ctx.stroke();
    }
    ctx.restore();
    // graticule (always on) — 30° parallels and meridians, equator and prime meridian emphasised
    ctx.globalAlpha = Math.min(1, inkProgress * 1.6);
    const line = (fn, emph) => {
      ctx.strokeStyle = emph ? 'rgba(34,60,64,.55)' : 'rgba(34,60,64,.22)'; ctx.lineWidth = emph ? 1.1 : 0.8;
      ctx.beginPath(); let pen = false;
      for (let k = 0; k <= 72; k += 1) {
        const q = this.project(fn(k / 72));
        if (q[2] >= 0) { if (pen) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); pen = true; } else pen = false;
      }
      ctx.stroke();
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      const cl = Math.cos(lat * D2R); const sl = Math.sin(lat * D2R);
      line((f) => rotZ([cl * Math.cos(f * TAU), cl * Math.sin(f * TAU), sl], rotE), lat === 0);
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const L = lon * D2R;
      line((f) => { const a = f * TAU; return rotZ([Math.cos(a) * Math.cos(L), Math.cos(a) * Math.sin(L), Math.sin(a)], rotE); }, lon === 0);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, K, -Math.PI / 2, -Math.PI / 2 + TAU * EASE(clamp(inkProgress / 0.45, 0, 1))); ctx.stroke();
  }

  planeRing(ctx, fn, fill) {
    const pts = [];
    for (let k = 0; k <= 120; k += 1) pts.push(this.project(fn((k / 120) * TAU)));
    if (fill) { ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.fillStyle = fill; ctx.fill(); }
    return pts;
  }

  /* reference samples → schematic space (cached per record) */
  referencePoints(record, maxPoints) {
    const source = record.reference;
    const cached = this.refCache.get(record.id);
    if (cached && cached.source === source && cached.maxPoints === maxPoints) return cached.points;
    const samples = Array.isArray(source) ? source.filter((sample) => finiteVector(sample?.positionKm)) : [];
    const step = Math.max(1, Math.ceil(samples.length / maxPoints));
    const points = [];
    for (let k = 0; k < samples.length; k += step) points.push(vis(toArray(samples[k].positionKm)));
    if (samples.length > 1 && points.length > 1) points.push(points[0]); // close the loop
    this.refCache.set(record.id, { source, maxPoints, points });
    return points;
  }

  inkProgress(now, hasOrbits) {
    if (this.plotDone) return 1;
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { this.finishInk(); return 1; }
    if (!hasOrbits) return 1;
    if (!this.plotStart) this.plotStart = now;
    const p = clamp((now - this.plotStart) / INK_MS, 0, 1);
    if (p >= 1) this.finishInk();
    else if (this.plotterEl) this.plotterEl.textContent = `INKING ${Math.round(p * 100)}%`;
    return p;
  }

  finishInk() {
    this.plotDone = true;
    if (this.plotterEl) this.plotterEl.textContent = 'PLOT OK';
  }

  isVisible() {
    return Boolean(this.ctx && this.canvas.isConnected && this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0);
  }

  /* ---------- frame ---------- */
  render(force = false) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    if (!force && !this.isVisible()) return;
    const canvas = this.canvas;
    const W = canvas.clientWidth; const H = canvas.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const bw = Math.round(W * dpr); const bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const damp = 1 - Math.exp(-dt * 9);
    const cam = this.cam; const target = this.camTarget;
    cam.yaw += (target.yaw - cam.yaw) * damp;
    cam.pitch += (target.pitch - cam.pitch) * damp;
    cam.zoom += (target.zoom - cam.zoom) * damp;
    // land exactly on the target once the remaining ease is invisible, so the camera (and the
    // cached globe projection keyed on it) comes to rest instead of creeping in the last bits
    if (Math.abs(target.yaw - cam.yaw) < 1e-5) cam.yaw = target.yaw;
    if (Math.abs(target.pitch - cam.pitch) < 1e-5) cam.pitch = target.pitch;
    if (Math.abs(target.zoom - cam.zoom) < 1e-5) cam.zoom = target.zoom;
    ctx.clearRect(0, 0, W, H);
    const gridKey = `${W}|${H}|${dpr}`;
    if (gridKey !== this.gridKey) { this.grid = this.buildGrid(W, H, dpr); this.gridKey = gridKey; }
    ctx.drawImage(this.grid, 0, 0, W, H);
    this.setupProjection(W, H);
    if (this.scaleBarEl) {
      const k = Math.round(this.pj.K);
      if (this.scaleBarEl._k !== k) { this.scaleBarEl._k = k; this.scaleBarEl.style.width = `${Math.min(180, k)}px`; }
    }

    const data = this.data;
    const mini = this.mini;
    const t = data.elapsed;
    const ecef = data.frame === 'ECEF';
    const theta = greenwichSiderealAngleAt(data.epochMs, t);
    // display frame: ECEF rotates by −θ (cos / sin hoisted out of the per-vertex path)
    const fc = Math.cos(-theta); const fs = Math.sin(-theta);
    const fr = ecef ? (v) => [v[0] * fc - v[1] * fs, v[0] * fs + v[1] * fc, v[2]] : (v) => v;
    const visible = data.orbits.filter((record) => record.visible !== false);
    const P = mini ? 1 : this.inkProgress(now, visible.length > 0);
    const sunEci = sunDirectionEci(data.epochMs + t * 1000);
    const sun = ecef ? rotZ(sunEci, -theta) : sunEci;

    let eqPts = null; let eclPts = null;
    if (!mini && data.overlays.radius) eqPts = this.planeRing(ctx, (a) => fr([PLANE_RADIUS * Math.cos(a), PLANE_RADIUS * Math.sin(a), 0]), 'rgba(42,143,176,.035)');
    if (!mini && data.overlays.ecliptic) eclPts = this.planeRing(ctx, (a) => fr([PLANE_RADIUS * Math.cos(a), PLANE_RADIUS * Math.sin(a) * Math.cos(ECLIPTIC_OBLIQUITY), PLANE_RADIUS * Math.sin(a) * Math.sin(ECLIPTIC_OBLIQUITY)]), 'rgba(224,112,58,.03)');
    this.drawEarth(ctx, ecef ? 0 : theta, sun, P);
    if (eqPts) {
      this.strokeRuns(ctx, eqPts, '#2A8FB0', 1, 0.55, [6, 4], 0.18);
      const q = eqPts[8]; ctx.fillStyle = '#22708A'; ctx.font = `500 10px ${FM}`; ctx.fillText('EQ PLANE', q[0] + 4, q[1] - 4);
    }
    if (eclPts) {
      this.strokeRuns(ctx, eclPts, '#E0703A', 1, 0.6, [2, 3], 0.18);
      const q = eclPts[22]; ctx.fillStyle = '#A64E1F'; ctx.font = `500 10px ${FM}`; ctx.fillText('ECLIPTIC 23.44°', q[0] + 4, q[1] - 4);
    }
    if (!mini && data.overlays.axes) {
      for (const [v, label] of [[[1, 0, 0], ecef ? 'X·ECEF' : 'X·ECI'], [[0, 1, 0], 'Y'], [[0, 0, 1], 'Z']]) {
        const pts = [];
        for (let s = 1; s <= 4.4; s += 0.1) pts.push(this.project([v[0] * s, v[1] * s, v[2] * s]));
        this.strokeRuns(ctx, pts, INK, 1, 0.7, null, 0.2);
        const e = pts[pts.length - 1]; const b = pts[pts.length - 3]; const ang = Math.atan2(e[1] - b[1], e[0] - b[0]);
        ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(e[0], e[1]);
        ctx.lineTo(e[0] - 8 * Math.cos(ang - 0.35), e[1] - 8 * Math.sin(ang - 0.35));
        ctx.lineTo(e[0] - 8 * Math.cos(ang + 0.35), e[1] - 8 * Math.sin(ang + 0.35)); ctx.fill();
        ctx.font = `600 11px ${FH}`; ctx.fillText(label, e[0] + 6, e[1] - 4);
      }
    }

    // orbits: dashed reference loop, fading trail, then markers + callouts on top
    const many = visible.length;
    const maxPoints = many <= 40 ? 180 : many <= 150 ? 72 : 28;
    const drawTrails = many <= 400;
    const callouts = !mini && many <= 24;
    const anySelected = visible.some((record) => data.selected.has(record.id));
    const labels = [];
    this.screenPoints = new Map();
    visible.forEach((record, index) => {
      const color = displayColorOnLight(record.color);
      const selected = data.selected.has(record.id);
      const hovered = !mini && this.hoverId === record.id;
      const fade = P >= 1 ? 1 : EASE(clamp((P - 0.18 - index * 0.09) / 0.5, 0, 1));
      const ref = this.referencePoints(record, maxPoints).map((p) => this.project(fr(p)));
      this.screenPoints.set(record.id, ref);
      const n = Math.max(2, Math.floor(ref.length * fade));
      if (mini || data.overlays.reference || fade < 1) {
        this.strokeRuns(ctx, ref.slice(0, n), color, selected || hovered ? 1.3 : 1, fade < 1 ? 0.9 : (anySelected && !selected ? 0.3 : 0.55), fade < 1 ? null : [5, 4], 0.16);
      }
      if (fade < 1) {
        const h = ref[n - 1];
        if (h) { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(h[0] - 6, h[1]); ctx.lineTo(h[0] + 6, h[1]); ctx.moveTo(h[0], h[1] - 6); ctx.lineTo(h[0], h[1] + 6); ctx.stroke(); }
        return;
      }
      const computed = data.computed.get(record.id);
      const current = computed?.state?.positionKm;
      if (drawTrails && Array.isArray(computed?.trail) && computed.trail.length > 1) {
        const trail = computed.trail.filter(finiteVector);
        const span = trailSpanSeconds(record.orbit?.periodSeconds ?? 0);
        const last = trail.length - 1;
        const tr = trail.map((p, k) => {
          const v = vis(toArray(p));
          if (!ecef) return this.project(v);
          return this.project(rotZ(v, -(theta - EARTH_RATE * span * (last ? 1 - k / last : 0))));
        });
        ctx.lineCap = 'round';
        for (let j = 1; j < tr.length; j += 1) {
          const a = tr[j - 1]; const b = tr[j];
          if (a[3] || b[3]) continue;
          ctx.globalAlpha = (j / tr.length) * (anySelected && !selected ? 0.5 : 1);
          ctx.strokeStyle = color; ctx.lineWidth = selected || hovered ? 2.6 : 1.8;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      }
      if (finiteVector(current)) {
        const p = toArray(current);
        labels.push({ record, color, selected, index, m: this.project(fr(vis(p))), alt: Math.hypot(...p) - RE });
      }
    });

    // markers + leader-line callouts (deck) or names only (mini)
    for (const label of labels) {
      const { record, m, selected, color } = label;
      const size = selected ? 6 : 5;
      ctx.globalAlpha = m[3] ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(m[0], m[1] - size); ctx.lineTo(m[0] + size, m[1]); ctx.lineTo(m[0], m[1] + size); ctx.lineTo(m[0] - size, m[1]); ctx.closePath();
      ctx.fillStyle = m[3] ? '#FFFFFF' : color; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
      if (selected && !m[3]) { ctx.strokeStyle = '#1B6B63'; ctx.lineWidth = 2; ctx.strokeRect(m[0] - 10, m[1] - 10, 20, 20); }
      if (mini) {
        if (many > 24 && !selected) { ctx.globalAlpha = 1; continue; }
        const sx = label.index % 2 ? -1 : 1; const sy = label.index % 4 > 1 ? 14 : -6;
        ctx.globalAlpha = m[3] ? 0.45 : 1; ctx.font = `700 10.5px ${FH}`;
        const w = ctx.measureText(record.name).width; const lx = sx > 0 ? m[0] + 11 : m[0] - 11 - w;
        if (selected) { ctx.fillStyle = '#8FE3D3'; ctx.fillRect(lx - 4, m[1] + sy - 11, w + 8, 14); }
        ctx.fillStyle = INK; ctx.fillText(record.name, lx, m[1] + sy); ctx.globalAlpha = 1;
        continue;
      }
      if (!callouts && !selected) { ctx.globalAlpha = 1; continue; }
      const dx = label.index % 2 ? -1 : 1; const dy = label.index % 4 > 1 ? 1 : -1;
      const ex = m[0] + dx * 16; const ey = m[1] + dy * 16; const len = 78;
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = m[3] ? 0.3 : 0.75;
      ctx.beginPath(); ctx.moveTo(m[0] + dx * 6, m[1] + dy * 6); ctx.lineTo(ex, ey); ctx.lineTo(ex + dx * len, ey); ctx.stroke();
      ctx.globalAlpha = m[3] ? 0.45 : 1;
      ctx.textAlign = dx > 0 ? 'left' : 'right';
      const tx = ex + dx * 2;
      ctx.font = `700 11px ${FH}`;
      if (selected) { const w = ctx.measureText(record.name).width + 8; ctx.fillStyle = '#8FE3D3'; ctx.fillRect(dx > 0 ? tx - 3 : tx - w + 3, ey - 16, w, 14); }
      ctx.fillStyle = INK; ctx.fillText(record.name, tx + (selected ? dx : 0), ey - 5);
      ctx.font = `500 10px ${FM}`; ctx.fillStyle = '#4A5F64';
      ctx.fillText(`ALT ${Math.round(label.alt).toLocaleString('en-US')} km`, tx, ey + 12);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }

    // calibration hits: hollow ring in the orbit colour around an ink dot
    if (!mini) {
      for (const marker of data.markers) {
        if (marker.visible === false) continue;
        const p = vis(toArray(marker.positionKm));
        const markerTheta = theta - EARTH_RATE * (t - Number(marker.elapsedSeconds || 0));
        const q = this.project(ecef ? rotZ(p, -markerTheta) : p);
        ctx.globalAlpha = q[3] ? 0.35 : 1;
        ctx.strokeStyle = displayColorOnLight(marker.color || '#3FB5A3'); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, TAU); ctx.stroke();
        ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(q[0], q[1], 2, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // hover: nearest reference sample within 9 px
    if (!mini && this.mouse && !this.drag) {
      let best = null; let bestDistance = 81;
      for (const record of visible) {
        const pts = this.screenPoints.get(record.id);
        if (!pts) continue;
        for (const q of pts) {
          const d = (q[0] - this.mouse.x) ** 2 + (q[1] - this.mouse.y) ** 2;
          if (d < bestDistance) { bestDistance = d; best = record; }
        }
      }
      this.setHover(best?.id ?? null, best ? { orbitRecord: best, clientX: this.mouse.clientX, clientY: this.mouse.clientY } : null);
    }
  }
}
