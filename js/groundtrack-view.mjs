import { displayColorOnLight } from './color.mjs';
import { greenwichSiderealAngleAt } from './groundtrack.mjs';
import { sunDirectionEci } from './schematic-scene.mjs';

const DEFAULT_MAP_SRC = './assets/maps/dark-world-map.svg';
const MIN_VIEW_SCALE = 1;
const MAX_VIEW_SCALE = 18;

// Canvas paint for the dark v2.1 map and the light V2.2 Firefly map.
const MAP_THEMES = {
  dark: {
    base: '#061015', fallback: ['#071015', '#0b1a1d', '#061116'], land: ['rgba(23, 53, 58, 0.86)', 'rgba(138, 196, 187, 0.38)'],
    grid: ['rgba(150, 190, 184, 0.23)', 'rgba(150, 190, 184, 0.16)'], equator: ['rgba(242, 222, 121, 0.58)', 'rgba(242, 222, 121, 0.22)'],
    cursor: 'rgba(124, 179, 136, 0.42)', selection: ['rgba(86, 140, 135, 0.12)', 'rgba(124, 179, 136, 0.82)'], pastAlpha: 0.24, trackColor: (hex) => hex,
  },
  light: {
    base: '#EEF4F3', fallback: ['#F4F8F7', '#EAF1F0', '#E2EBE9'], land: ['rgba(207, 221, 218, 0.95)', 'rgba(34, 66, 70, 0.5)'],
    grid: ['rgba(40, 78, 80, 0.3)', 'rgba(40, 78, 80, 0.18)'], equator: ['rgba(184, 119, 10, 0.85)', 'rgba(184, 119, 10, 0.35)'],
    cursor: 'rgba(42, 143, 176, 0.7)', selection: ['rgba(62, 230, 214, 0.12)', 'rgba(27, 107, 99, 0.85)'], pastAlpha: 0.35, trackColor: displayColorOnLight,
    // V2.2 Firefly: framed paper map, 15° graticule, terminator, named markers, persistent region box
    prototype: true,
  },
};
const INK = '#22323A';
const FH = '"Chakra Petch","Bahnschrift","Microsoft YaHei",sans-serif';
const FM = '"JetBrains Mono",Consolas,"SFMono-Regular",monospace';
const signed = (value, digits) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLongitudeForProjection(longitudeDeg) {
  const raw = finiteNumber(longitudeDeg);
  if (raw === 180) return 180;
  const wrapped = ((raw + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function hexToRgb(hex) {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : '568c87';
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function colorWithAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return '--';
  return Number(value).toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatSimulationTime(seconds) {
  return `${formatNumber(seconds, 2)} s`;
}

export function formatUtc(utcValue) {
  const utcMs = utcValue instanceof Date ? utcValue.getTime() : Number.isFinite(Number(utcValue)) ? Number(utcValue) : Date.parse(utcValue);
  if (!Number.isFinite(utcMs)) return '--';
  const date = new Date(utcMs);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}   ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function pointDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function lonLatToMapPoint(longitudeDeg, latitudeDeg, width, height) {
  const safeWidth = Math.max(1, finiteNumber(width, 1));
  const safeHeight = Math.max(1, finiteNumber(height, 1));
  const longitude = normalizeLongitudeForProjection(longitudeDeg);
  const latitude = clamp(finiteNumber(latitudeDeg), -90, 90);

  return {
    x: ((longitude + 180) / 360) * safeWidth,
    y: ((90 - latitude) / 180) * safeHeight,
  };
}

export function mapPointToLonLat(x, y, width, height) {
  const safeWidth = Math.max(1, finiteNumber(width, 1));
  const safeHeight = Math.max(1, finiteNumber(height, 1));
  const clampedX = clamp(finiteNumber(x), 0, safeWidth);
  const clampedY = clamp(finiteNumber(y), 0, safeHeight);

  return {
    longitudeDeg: (clampedX / safeWidth) * 360 - 180,
    latitudeDeg: 90 - (clampedY / safeHeight) * 180,
  };
}

export function normalizeMapViewport(viewport = {}, width = 1, height = 1) {
  const safeWidth = finiteNumber(width, 0);
  const safeHeight = finiteNumber(height, 0);
  if (safeWidth <= 0 || safeHeight <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const scale = clamp(finiteNumber(viewport.scale, 1), MIN_VIEW_SCALE, MAX_VIEW_SCALE);
  const minOffsetX = safeWidth - safeWidth * scale;
  const minOffsetY = safeHeight - safeHeight * scale;

  return {
    scale,
    offsetX: scale === 1 ? 0 : clamp(finiteNumber(viewport.offsetX, 0), minOffsetX, 0),
    offsetY: scale === 1 ? 0 : clamp(finiteNumber(viewport.offsetY, 0), minOffsetY, 0),
  };
}

export function selectionToLonLatBounds(selection, viewport, width, height) {
  const normalizedViewport = normalizeMapViewport(viewport, width, height);
  const left = Math.min(finiteNumber(selection.startX), finiteNumber(selection.endX));
  const right = Math.max(finiteNumber(selection.startX), finiteNumber(selection.endX));
  const top = Math.min(finiteNumber(selection.startY), finiteNumber(selection.endY));
  const bottom = Math.max(finiteNumber(selection.startY), finiteNumber(selection.endY));
  const westNorth = screenPointToLonLat(left, top, normalizedViewport, width, height);
  const eastSouth = screenPointToLonLat(right, bottom, normalizedViewport, width, height);

  return {
    westDeg: Math.min(westNorth.longitudeDeg, eastSouth.longitudeDeg),
    eastDeg: Math.max(westNorth.longitudeDeg, eastSouth.longitudeDeg),
    southDeg: Math.min(westNorth.latitudeDeg, eastSouth.latitudeDeg),
    northDeg: Math.max(westNorth.latitudeDeg, eastSouth.latitudeDeg),
  };
}

function screenPointToMapPoint(x, y, viewport) {
  return {
    x: (finiteNumber(x) - viewport.offsetX) / viewport.scale,
    y: (finiteNumber(y) - viewport.offsetY) / viewport.scale,
  };
}

function screenPointToLonLat(x, y, viewport, width, height) {
  const mapPoint = screenPointToMapPoint(x, y, viewport);
  return mapPointToLonLat(mapPoint.x, mapPoint.y, width, height);
}

function splitRenderableSegments(points) {
  const segments = [];
  let current = [];
  for (const point of points ?? []) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      if (Math.abs(point.longitudeDeg - previous.longitudeDeg) > 180) {
        segments.push(current);
        current = [];
      }
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function drawPath(ctx, points, toScreenPoint) {
  let started = false;
  for (const point of points) {
    const screenPoint = toScreenPoint(point);
    if (!started) {
      ctx.moveTo(screenPoint.x, screenPoint.y);
      started = true;
    } else {
      ctx.lineTo(screenPoint.x, screenPoint.y);
    }
  }
}

function regionSummaryHtml(stats) {
  if (!stats) return '';
  const bounds = stats.bounds ?? {};
  const timeText = stats.earliestUtcMs === null || stats.latestUtcMs === null
    ? '--'
    : `${formatUtc(stats.earliestUtcMs)} - ${formatUtc(stats.latestUtcMs)}`;
  return `
    <strong>区域星下点统计</strong>
    <dl>
      <dt>经度</dt><dd>${formatNumber(bounds.westDeg, 2)}° ~ ${formatNumber(bounds.eastDeg, 2)}°</dd>
      <dt>纬度</dt><dd>${formatNumber(bounds.southDeg, 2)}° ~ ${formatNumber(bounds.northDeg, 2)}°</dd>
      <dt>命中轨道</dt><dd>${stats.totalOrbitCount ?? 0}</dd>
      <dt>轨迹点数</dt><dd>${stats.totalPointCount ?? 0}</dd>
      <dt>UTC</dt><dd>${escapeHtml(timeText)}</dd>
    </dl>
  `;
}

export class GroundTrackView {
  constructor({
    canvas,
    tooltip,
    selectionSummary,
    mapSrc = DEFAULT_MAP_SRC,
    onRegionSelected = null,
    theme = 'dark',
    readout = null,
  } = {}) {
    this.theme = MAP_THEMES[theme] ?? MAP_THEMES.dark;
    this.readout = readout;
    this.region = null;
    this.hover = null;
    this.utcMs = null;
    this.pulseRunning = false;
    this.canvas = canvas ?? null;
    this.ctx = this.canvas?.getContext?.('2d') ?? null;
    this.tooltip = tooltip ?? null;
    this.selectionSummary = selectionSummary ?? null;
    this.mapSrc = mapSrc;
    this.mapImage = null;
    this.tracks = [];
    this.selectedIds = [];
    this.elapsedSeconds = 0;
    this.isPlaying = false;
    this.isPanelOpen = false;
    this.isFullscreen = false;
    this.options = {
      highlightLongitude: false,
      highlightLatitude: false,
      highlightEquator: true,
      cursorGuides: true,
    };
    this.cursorPoint = null;
    this.viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dragMode = null;
    this.dragStart = null;
    this.lastPointer = null;
    this.selection = null;
    this.onRegionSelected = onRegionSelected;

    this.onWheel = this.onWheel.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.loadMapImage();
    this.bindEvents();
    this.resize();
  }

  loadMapImage() {
    if (typeof Image === 'undefined') return;
    this.mapImage = new Image();
    this.mapImage.onload = () => this.draw();
    this.mapImage.src = this.mapSrc;
  }

  bindEvents() {
    if (!this.canvas) return;
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerleave', () => {
      this.cursorPoint = null;
      this.hover = null;
      if (this.readout) this.readout.textContent = 'LON — · LAT —';
      if (!this.dragMode) this.hideTooltip();
      this.draw();
    });
  }

  setRegionSelectedCallback(callback) {
    this.onRegionSelected = callback;
  }

  setData(tracks = [], options = {}) {
    const nextTracks = Array.isArray(tracks) ? tracks : [];
    let nextSelectedIds = this.selectedIds;
    if (Array.isArray(options.selectedIds)) {
      nextSelectedIds = [...new Set(options.selectedIds.filter(Boolean))];
    } else if ('selectedId' in options) {
      nextSelectedIds = options.selectedId ? [options.selectedId] : [];
    }
    if (Number.isFinite(options.utcMs)) this.utcMs = options.utcMs;
    const nextElapsedSeconds = finiteNumber(options.elapsedSeconds, this.elapsedSeconds);
    const nextIsPlaying = Boolean(options.isPlaying);
    const tracksUnchanged = nextTracks === this.tracks
      || (nextTracks.length === this.tracks.length && nextTracks.every((track, index) => track === this.tracks[index]));
    const selectionUnchanged = nextSelectedIds.length === this.selectedIds.length
      && nextSelectedIds.every((id, index) => id === this.selectedIds[index]);
    if (tracksUnchanged && selectionUnchanged && nextElapsedSeconds === this.elapsedSeconds && nextIsPlaying === this.isPlaying) return;
    this.tracks = nextTracks;
    this.selectedIds = nextSelectedIds;
    this.elapsedSeconds = nextElapsedSeconds;
    this.isPlaying = nextIsPlaying;
    if (this.isPanelOpen) this.draw();
  }

  setOptions(options = {}) {
    if (Object.entries(options).every(([key, value]) => this.options[key] === value)) return;
    this.options = { ...this.options, ...options };
    if (this.isPanelOpen) this.draw();
  }

  setPanelOpen(isPanelOpen) {
    const nextIsPanelOpen = Boolean(isPanelOpen);
    if (nextIsPanelOpen === this.isPanelOpen) return;
    this.isPanelOpen = nextIsPanelOpen;
    if (this.isPanelOpen) {
      this.draw();
      this.startPulse();
    }
  }

  setFullscreen(isFullscreen) {
    const nextIsFullscreen = Boolean(isFullscreen);
    if (nextIsFullscreen === this.isFullscreen) return;
    this.isFullscreen = nextIsFullscreen;
    if (this.isPanelOpen) this.draw();
  }

  resetView() {
    this.viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    this.selection = null;
    this.hideSelectionSummary();
    this.draw();
  }

  resize() {
    if (!this.canvas || !this.ctx) return false;
    const rect = this.canvas.getBoundingClientRect();
    const nextWidth = Math.round(rect.width);
    const nextHeight = Math.round(rect.height);
    if (nextWidth <= 0 || nextHeight <= 0) return false;

    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(nextWidth * dpr) || this.canvas.height !== Math.round(nextHeight * dpr)) {
      this.canvas.width = Math.round(nextWidth * dpr);
      this.canvas.height = Math.round(nextHeight * dpr);
      this.cssWidth = nextWidth;
      this.cssHeight = nextHeight;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewport = normalizeMapViewport(this.viewport, this.cssWidth, this.cssHeight);
      return true;
    }

    this.cssWidth = nextWidth;
    this.cssHeight = nextHeight;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewport = normalizeMapViewport(this.viewport, this.cssWidth, this.cssHeight);
    return true;
  }

  capturePng({ width = null, height = null } = {}) {
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return this.captureFixedSizePng(width, height);
    }
    this.resize();
    this.draw();
    return this.canvas?.toDataURL?.('image/png') ?? '';
  }

  captureFixedSizePng(width, height) {
    if (typeof document === 'undefined') return '';
    const target = document.createElement('canvas');
    target.width = Math.round(width);
    target.height = Math.round(height);
    const targetCtx = target.getContext('2d');

    const previous = {
      ctx: this.ctx,
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      viewport: { ...this.viewport },
    };
    this.ctx = targetCtx;
    this.cssWidth = target.width;
    this.cssHeight = target.height;
    this.viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    if (this.theme.prototype) this.drawPrototypeMap(targetCtx, { interactive: false });
    else {
      this.drawBaseMap(targetCtx);
      this.drawGrid(targetCtx);
      this.drawTracks(targetCtx);
    }
    this.ctx = previous.ctx;
    this.cssWidth = previous.cssWidth;
    this.cssHeight = previous.cssHeight;
    this.viewport = previous.viewport;
    return target.toDataURL('image/png');
  }

  setSelectionStats(stats) {
    if (!this.selectionSummary || !stats) {
      this.hideSelectionSummary();
      return;
    }
    this.selectionSummary.innerHTML = regionSummaryHtml(stats);
    this.selectionSummary.hidden = false;
    this.selectionSummary.style.left = '14px';
    this.selectionSummary.style.bottom = '14px';
  }

  hideSelectionSummary() {
    if (!this.selectionSummary) return;
    this.selectionSummary.hidden = true;
    this.selectionSummary.innerHTML = '';
  }

  mapPointToScreen(point) {
    return {
      x: point.x * this.viewport.scale + this.viewport.offsetX,
      y: point.y * this.viewport.scale + this.viewport.offsetY,
    };
  }

  lonLatToScreen(longitudeDeg, latitudeDeg) {
    return this.mapPointToScreen(lonLatToMapPoint(longitudeDeg, latitudeDeg, this.cssWidth, this.cssHeight));
  }

  groundPointToScreen(point) {
    return this.lonLatToScreen(point.longitudeDeg, point.latitudeDeg);
  }

  draw() {
    if (!this.ctx || !this.resize()) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (this.theme.prototype) {
      this.drawPrototypeMap(ctx, { interactive: true });
      return;
    }
    this.drawBaseMap(ctx);
    this.drawGrid(ctx);
    this.drawTracks(ctx);
    this.drawCursorGuides(ctx);
    this.drawSelection(ctx);
  }

  drawBaseMap(ctx) {
    ctx.save();
    ctx.fillStyle = this.theme.base;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const drawX = this.viewport.offsetX;
    const drawY = this.viewport.offsetY;
    const drawWidth = this.cssWidth * this.viewport.scale;
    const drawHeight = this.cssHeight * this.viewport.scale;
    if (this.mapImage?.complete && this.mapImage.naturalWidth > 0) {
      ctx.globalAlpha = 0.96;
      ctx.drawImage(this.mapImage, drawX, drawY, drawWidth, drawHeight);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, this.cssWidth, this.cssHeight);
      gradient.addColorStop(0, this.theme.fallback[0]);
      gradient.addColorStop(0.55, this.theme.fallback[1]);
      gradient.addColorStop(1, this.theme.fallback[2]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
      this.drawFallbackLand(ctx);
    }
    ctx.restore();
  }

  drawFallbackLand(ctx) {
    const continents = [
      [[-165, 56], [-128, 70], [-92, 62], [-62, 48], [-52, 20], [-88, 4], [-104, -18], [-132, -8], [-154, 24]],
      [[-78, 12], [-52, -10], [-48, -36], [-62, -56], [-74, -32]],
      [[-10, 62], [36, 68], [74, 56], [108, 44], [148, 36], [154, 4], [98, -20], [54, -8], [24, -34], [-16, -16], [-36, 26]],
      [[18, 8], [38, -12], [48, -34], [26, -36], [8, -10]],
      [[112, -10], [150, -30], [146, -44], [116, -38], [104, -22]],
      [[-44, 72], [-20, 78], [10, 72], [0, 64]],
    ];

    ctx.save();
    ctx.fillStyle = this.theme.land[0];
    ctx.strokeStyle = this.theme.land[1];
    ctx.lineWidth = 1.5;
    for (const polygon of continents) {
      ctx.beginPath();
      polygon.forEach(([longitudeDeg, latitudeDeg], index) => {
        const point = this.lonLatToScreen(longitudeDeg, latitudeDeg);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = this.options.highlightLongitude || this.options.highlightLatitude
      ? this.theme.grid[0]
      : this.theme.grid[1];
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 8]);

    for (let longitude = -180; longitude <= 180; longitude += 30) {
      ctx.globalAlpha = this.options.highlightLongitude ? 1 : 0.78;
      const top = this.lonLatToScreen(longitude, 90);
      const bottom = this.lonLatToScreen(longitude, -90);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }

    for (let latitude = -60; latitude <= 60; latitude += 30) {
      ctx.globalAlpha = this.options.highlightLatitude ? 1 : 0.78;
      const left = this.lonLatToScreen(-180, latitude);
      const right = this.lonLatToScreen(180, latitude);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.options.highlightEquator ? this.theme.equator[0] : this.theme.equator[1];
    ctx.lineWidth = this.options.highlightEquator ? 1.6 : 1;
    const equatorLeft = this.lonLatToScreen(-180, 0);
    const equatorRight = this.lonLatToScreen(180, 0);
    ctx.beginPath();
    ctx.moveTo(equatorLeft.x, equatorLeft.y);
    ctx.lineTo(equatorRight.x, equatorRight.y);
    ctx.stroke();
    ctx.restore();
  }

  drawCursorGuides(ctx) {
    if (!this.options.cursorGuides || !this.cursorPoint) return;
    ctx.save();
    ctx.strokeStyle = this.theme.cursor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(this.cursorPoint.x, 0);
    ctx.lineTo(this.cursorPoint.x, this.cssHeight);
    ctx.moveTo(0, this.cursorPoint.y);
    ctx.lineTo(this.cssWidth, this.cursorPoint.y);
    ctx.stroke();
    ctx.restore();
  }

  drawTracks(ctx) {
    const selectedIds = new Set(this.selectedIds);
    const hasSelection = selectedIds.size > 0;
    for (const track of this.tracks) {
      const selected = hasSelection && selectedIds.has(track.id);
      const muted = hasSelection && !selected;
      const opacityScale = selected ? 1.18 : muted ? 0.68 : 1;
      this.drawTrackLine(ctx, track, opacityScale);
    }
    for (const track of this.tracks) {
      const selected = hasSelection && selectedIds.has(track.id);
      const muted = hasSelection && !selected;
      this.drawCurrentMarker(ctx, track, selected, muted);
    }
  }

  drawTrackLine(ctx, track, opacityScale = 1) {
    const fallbackSegments = track.segments?.length ? track.segments : splitRenderableSegments(track.points);
    const pastSegments = track.pastSegments?.length ? track.pastSegments : fallbackSegments.slice(0, -1);
    const currentSegments = track.currentSegments?.length
      ? track.currentSegments
      : fallbackSegments.slice(Math.max(0, fallbackSegments.length - 1));

    const color = this.theme.trackColor(track.color);
    this.drawTrackSegmentGroup(ctx, pastSegments, {
      color,
      alpha: this.theme.pastAlpha * opacityScale,
      lineWidth: 1.45,
    });
    this.drawTrackSegmentGroup(ctx, currentSegments, {
      color,
      alpha: 0.88 * opacityScale,
      lineWidth: 2.25,
    });
  }

  drawTrackSegmentGroup(ctx, segments, { color, alpha, lineWidth }) {
    for (const segment of segments) {
      for (let index = 1; index < segment.length; index += 1) {
        const previous = segment[index - 1];
        const point = segment[index];
        ctx.save();
        ctx.strokeStyle = colorWithAlpha(color, alpha);
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        drawPath(ctx, [previous, point], (groundPoint) => this.groundPointToScreen(groundPoint));
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawCurrentMarker(ctx, track, selected = false, muted = false) {
    if (!track.current) return;
    const point = this.groundPointToScreen(track.current);
    const radius = selected ? 5.8 : 4.6;
    const alpha = muted ? 0.58 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    const color = this.theme.trackColor(track.color);
    ctx.fillStyle = colorWithAlpha(color, 0.95);
    ctx.strokeStyle = colorWithAlpha(color, 0.26);
    ctx.lineWidth = selected ? 8 : 6;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawSelection(ctx) {
    if (!this.selection) return;
    const left = Math.min(this.selection.startX, this.selection.endX);
    const top = Math.min(this.selection.startY, this.selection.endY);
    const width = Math.abs(this.selection.endX - this.selection.startX);
    const height = Math.abs(this.selection.endY - this.selection.startY);
    ctx.save();
    ctx.fillStyle = this.theme.selection[0];
    ctx.strokeStyle = this.theme.selection[1];
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  }

  onWheel(event) {
    if (!this.isPanelOpen) return;
    event.preventDefault();
    this.resize();
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const before = screenPointToMapPoint(x, y, this.viewport);
    const nextScale = clamp(this.viewport.scale * Math.exp(-event.deltaY * 0.001), MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    this.viewport = normalizeMapViewport({
      scale: nextScale,
      offsetX: x - before.x * nextScale,
      offsetY: y - before.y * nextScale,
    }, this.cssWidth, this.cssHeight);
    this.draw();
  }

  onPointerDown(event) {
    if (!this.isPanelOpen || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    const point = this.pointerPoint(event);
    this.dragMode = event.shiftKey || event.button === 2 ? 'select' : 'pan';
    this.dragStart = point;
    this.lastPointer = point;
    if (this.dragMode === 'select') {
      this.selection = { startX: point.x, startY: point.y, endX: point.x, endY: point.y };
      this.hideSelectionSummary();
    }
    this.canvas.setPointerCapture?.(event.pointerId);
    this.hideTooltip();
  }

  onPointerMove(event) {
    if (!this.isPanelOpen) return;
    const point = this.pointerPoint(event);
    if (this.dragMode === 'pan' && this.lastPointer) {
      event.preventDefault();
      this.viewport = normalizeMapViewport({
        ...this.viewport,
        offsetX: this.viewport.offsetX + point.x - this.lastPointer.x,
        offsetY: this.viewport.offsetY + point.y - this.lastPointer.y,
      }, this.cssWidth, this.cssHeight);
      this.lastPointer = point;
      this.draw();
      return;
    }
    if (this.dragMode === 'select' && this.selection) {
      event.preventDefault();
      this.selection.endX = point.x;
      this.selection.endY = point.y;
      this.draw();
      return;
    }

    this.cursorPoint = point;
    if (this.readout) {
      const map = screenPointToMapPoint(point.x, point.y, this.viewport);
      const lonLat = mapPointToLonLat(map.x, map.y, this.cssWidth, this.cssHeight);
      const inside = map.x >= 0 && map.x <= this.cssWidth && map.y >= 0 && map.y <= this.cssHeight;
      this.readout.textContent = inside ? `LON ${signed(lonLat.longitudeDeg, 3)}° · LAT ${signed(lonLat.latitudeDeg, 3)}°` : 'LON — · LAT —';
    }
    const hit = this.findNearestTrackPoint(point);
    this.hover = hit;
    if (hit) this.showTooltip(hit, point);
    else this.hideTooltip();
    if (this.theme.prototype) this.draw();
  }

  onPointerUp(event) {
    if (!this.dragMode) return;
    const wasSelecting = this.dragMode === 'select' && this.selection;
    this.canvas?.releasePointerCapture?.(event.pointerId);
    this.dragMode = null;
    this.lastPointer = null;

    if (wasSelecting) {
      const width = Math.abs(this.selection.endX - this.selection.startX);
      const height = Math.abs(this.selection.endY - this.selection.startY);
      const selection = this.selection;
      this.selection = null;
      if (width > 8 && height > 8) {
        const bounds = selectionToLonLatBounds(selection, this.viewport, this.cssWidth, this.cssHeight);
        if (this.theme.prototype) this.region = bounds;
        else this.zoomToBounds(bounds);
        this.onRegionSelected?.(bounds);
      }
    }
    this.draw();
  }

  pointerPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  findNearestTrackPoint(screenPoint) {
    let best = null;
    let bestDistance = Infinity;
    for (const track of this.tracks) {
      if (track.current) {
        const currentScreen = this.groundPointToScreen(track.current);
        const distance = pointDistanceSquared(currentScreen, screenPoint);
        if (distance < 144 && distance < bestDistance) {
          best = { track, point: track.current };
          bestDistance = distance;
        }
      }

      const points = track.points ?? [];
      const step = Math.max(1, Math.ceil(points.length / 700));
      for (let index = 0; index < points.length; index += step) {
        const point = points[index];
        const screen = this.groundPointToScreen(point);
        const distance = pointDistanceSquared(screen, screenPoint);
        if (distance < 64 && distance < bestDistance) {
          best = { track, point };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  showTooltip(hit, screenPoint) {
    if (!this.tooltip) return;
    const { track, point } = hit;
    this.tooltip.innerHTML = `
      <strong>${escapeHtml(track.name)}</strong>
      <dl>
        <dt>经度</dt><dd>${formatNumber(point.longitudeDeg, 4)}°</dd>
        <dt>纬度</dt><dd>${formatNumber(point.latitudeDeg, 4)}°</dd>
        <dt>仿真时刻</dt><dd>${formatSimulationTime(point.elapsedSeconds)}</dd>
        <dt>UTC</dt><dd>${escapeHtml(formatUtc(point.utcMs))}</dd>
        <dt>动力学</dt><dd>${escapeHtml(point.perturbationModel)}</dd>
      </dl>
    `;
    this.tooltip.style.borderColor = track.color;
    this.tooltip.style.left = `${Math.min(this.cssWidth - 280, Math.max(8, screenPoint.x + 14))}px`;
    this.tooltip.style.top = `${Math.min(this.cssHeight - 148, Math.max(8, screenPoint.y + 14))}px`;
    this.tooltip.hidden = false;
  }

  hideTooltip() {
    if (!this.tooltip) return;
    this.tooltip.hidden = true;
  }

  clearRegion() {
    this.region = null;
    this.hideSelectionSummary();
    this.draw();
  }

  // Current-position pulse rings keep moving while the map is on screen.
  startPulse() {
    if (!this.theme.prototype || this.pulseRunning || typeof requestAnimationFrame === 'undefined') return;
    this.pulseRunning = true;
    const loop = () => {
      if (!this.isPanelOpen || !this.tracks.some((track) => track.current)) { this.pulseRunning = false; return; }
      if (!this.dragMode) this.draw();
      setTimeout(() => requestAnimationFrame(loop), 60);
    };
    requestAnimationFrame(loop);
  }

  mapExtent() {
    const a = this.mapPointToScreen({ x: 0, y: 0 });
    const b = this.mapPointToScreen({ x: this.cssWidth, y: this.cssHeight });
    return { x0: a.x, y0: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  drawPrototypeMap(ctx, { interactive }) {
    const R = this.mapExtent();
    const X = (lon) => R.x0 + ((lon + 180) / 360) * R.w;
    const Y = (lat) => R.y0 + ((90 - lat) / 180) * R.h;
    ctx.save();
    ctx.fillStyle = '#F7FAF9'; ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = '#EEF5F3'; ctx.fillRect(R.x0, R.y0, R.w, R.h);
    if (this.mapImage?.complete && this.mapImage.naturalWidth > 0) ctx.drawImage(this.mapImage, R.x0, R.y0, R.w, R.h);
    else this.drawFallbackLand(ctx);
    // graticule: 15° minor, 30° major, prime meridian emphasised; highlight options tint blue
    const { highlightLongitude, highlightLatitude, highlightEquator } = this.options;
    for (let lon = -180; lon <= 180; lon += 15) {
      const major = lon % 30 === 0;
      const x = Math.round(X(lon)) + 0.5;
      ctx.strokeStyle = highlightLongitude && major ? 'rgba(42,143,176,.55)' : major ? 'rgba(34,60,64,.2)' : 'rgba(34,60,64,.08)';
      ctx.lineWidth = highlightLongitude && major ? 1.2 : 1;
      if (lon === 0) ctx.strokeStyle = highlightLongitude ? '#2A8FB0' : 'rgba(34,60,64,.42)';
      ctx.beginPath(); ctx.moveTo(x, R.y0); ctx.lineTo(x, R.y0 + R.h); ctx.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      if (lat === 0) continue;
      const major = lat % 30 === 0;
      const y = Math.round(Y(lat)) + 0.5;
      ctx.strokeStyle = highlightLatitude && major ? 'rgba(42,143,176,.55)' : major ? 'rgba(34,60,64,.2)' : 'rgba(34,60,64,.08)';
      ctx.lineWidth = highlightLatitude && major ? 1.2 : 1;
      ctx.beginPath(); ctx.moveTo(R.x0, y); ctx.lineTo(R.x0 + R.w, y); ctx.stroke();
    }
    const ey = Math.round(Y(0)) + 0.5;
    ctx.strokeStyle = highlightEquator ? '#D4553A' : 'rgba(34,60,64,.42)';
    ctx.lineWidth = highlightEquator ? 1.4 : 1;
    if (highlightEquator) ctx.setLineDash([10, 3, 2, 3]);
    ctx.beginPath(); ctx.moveTo(R.x0, ey); ctx.lineTo(R.x0 + R.w, ey); ctx.stroke(); ctx.setLineDash([]);
    // frame + coordinate labels
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(R.x0) + 0.5, Math.round(R.y0) + 0.5, Math.round(R.w) - 1, Math.round(R.h) - 1);
    ctx.fillStyle = '#4A5F64'; ctx.font = `500 9.5px ${FM}`;
    if (R.w > 500) {
      for (let lon = -150; lon <= 150; lon += 30) ctx.fillText(lon < 0 ? `${-lon}W` : lon > 0 ? `${lon}E` : '0', X(lon) + 3, Math.max(R.y0, 0) + 11);
      for (let lat = -60; lat <= 60; lat += 30) ctx.fillText(lat < 0 ? `${-lat}S` : lat > 0 ? `${lat}N` : 'EQ', Math.max(R.x0, 0) + 4, Y(lat) - 3);
    }
    // night side and subsolar point at the current UTC instant
    if (Number.isFinite(this.utcMs)) {
      const sun = sunDirectionEci(this.utcMs);
      const theta = greenwichSiderealAngleAt(this.utcMs, 0);
      const c = Math.cos(theta); const s = Math.sin(theta);
      const sx = sun[0] * c + sun[1] * s; const sy = -sun[0] * s + sun[1] * c;
      const sLon = Math.atan2(sy, sx); const sLat = Math.asin(sun[2]);
      const tanL = Math.tan(sLat) || 1e-6;
      ctx.fillStyle = 'rgba(34,60,64,.07)'; ctx.beginPath();
      for (let k = 0; k <= 120; k += 1) {
        const lon = -180 + k * 3;
        const lat = Math.atan(-Math.cos(lon * Math.PI / 180 - sLon) / tanL) * 180 / Math.PI;
        if (k) ctx.lineTo(X(lon), Y(lat)); else ctx.moveTo(X(lon), Y(lat));
      }
      const nightPole = sLat > 0 ? -90 : 90;
      ctx.lineTo(X(180), Y(nightPole)); ctx.lineTo(X(-180), Y(nightPole)); ctx.closePath(); ctx.fill();
      const sunX = X(((sLon * 180 / Math.PI + 540) % 360) - 180); const sunY = Y(sLat * 180 / Math.PI);
      ctx.strokeStyle = '#E0703A'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(sunX, sunY, 5, 0, Math.PI * 2);
      for (let a = 0; a < 8; a += 1) { const q = (a * Math.PI) / 4; ctx.moveTo(sunX + Math.cos(q) * 7, sunY + Math.sin(q) * 7); ctx.lineTo(sunX + Math.cos(q) * 10, sunY + Math.sin(q) * 10); }
      ctx.stroke();
    }
    // tracks: older history faint, latest stretch solid
    const selectedIds = new Set(this.selectedIds);
    for (const track of this.tracks) {
      const selected = selectedIds.has(track.id);
      const fallback = track.segments?.length ? track.segments : splitRenderableSegments(track.points);
      const past = track.pastSegments?.length ? track.pastSegments : fallback.slice(0, -1);
      const current = track.currentSegments?.length ? track.currentSegments : fallback.slice(Math.max(0, fallback.length - 1));
      const color = this.theme.trackColor(track.color);
      this.drawTrackSegmentGroup(ctx, past, { color, alpha: 0.35, lineWidth: selected ? 2 : 1.4 });
      this.drawTrackSegmentGroup(ctx, current, { color, alpha: 1, lineWidth: selected ? 2 : 1.4 });
    }
    // current positions: pulse ring, ink-outlined diamond, slate name tag
    const phase = interactive ? (performance.now() / 1600) % 1 : 0.5;
    for (const track of this.tracks) {
      if (!track.current) continue;
      const color = this.theme.trackColor(track.color);
      const p = this.groundPointToScreen(track.current);
      ctx.strokeStyle = color; ctx.globalAlpha = 1 - phase; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6 + phase * 16, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y); ctx.lineTo(p.x, p.y + 6); ctx.lineTo(p.x - 6, p.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.font = `700 10.5px ${FH}`;
      const tw = ctx.measureText(track.name ?? '').width;
      ctx.fillStyle = INK; ctx.fillRect(p.x + 9, p.y - 19, tw + 8, 14);
      ctx.fillStyle = '#FFFFFF'; ctx.fillText(track.name ?? '', p.x + 13, p.y - 8);
    }
    // persistent region box: mint frame with ink hatching and a bounds label
    const box = this.region;
    if (box) {
      const x1 = X(box.westDeg); const x2 = X(box.eastDeg); const y1 = Y(box.northDeg); const y2 = Y(box.southDeg);
      const spans = x1 <= x2 ? [[x1, x2]] : [[x1, R.x0 + R.w], [R.x0, x2]];
      for (const [a, b] of spans) {
        ctx.fillStyle = this.theme.selection[0]; ctx.fillRect(a, y1, b - a, y2 - y1);
        ctx.save(); ctx.beginPath();
        ctx.rect(a - 3, y1 - 3, b - a + 6, y2 - y1 + 6); ctx.rect(a + 3, y1 + 3, Math.max(0, b - a - 6), Math.max(0, y2 - y1 - 6));
        ctx.clip('evenodd');
        ctx.fillStyle = '#8FE3D3'; ctx.fillRect(a - 3, y1 - 3, b - a + 6, y2 - y1 + 6);
        ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath();
        for (let d = a - (y2 - y1) - 20; d < b + 20; d += 10) { ctx.moveTo(d, y2 + 4); ctx.lineTo(d + (y2 - y1) + 8, y1 - 4); }
        ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = INK; ctx.font = `600 10px ${FM}`;
      const label = `${box.westDeg.toFixed(1)}°…${box.eastDeg.toFixed(1)}° / ${box.southDeg.toFixed(1)}°…${box.northDeg.toFixed(1)}°`;
      const lw = ctx.measureText(label).width + 10;
      ctx.fillRect(x1 - 3, y1 - 19, lw, 15); ctx.fillStyle = '#8FE3D3'; ctx.fillText(label, x1 + 2, y1 - 8);
    }
    if (interactive) {
      this.drawSelection(ctx);
      if (this.options.cursorGuides && this.cursorPoint && !this.dragMode) {
        ctx.strokeStyle = this.theme.cursor; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(this.cursorPoint.x) + 0.5, R.y0); ctx.lineTo(Math.round(this.cursorPoint.x) + 0.5, R.y0 + R.h);
        ctx.moveTo(R.x0, Math.round(this.cursorPoint.y) + 0.5); ctx.lineTo(R.x0 + R.w, Math.round(this.cursorPoint.y) + 0.5);
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (this.hover && !this.dragMode) {
        const p = this.groundPointToScreen(this.hover.point);
        ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
      }
    }
    ctx.restore();
  }

  zoomToBounds(bounds) {
    const westNorth = lonLatToMapPoint(bounds.westDeg, bounds.northDeg, this.cssWidth, this.cssHeight);
    const eastSouth = lonLatToMapPoint(bounds.eastDeg, bounds.southDeg, this.cssWidth, this.cssHeight);
    const spanX = Math.max(8, Math.abs(eastSouth.x - westNorth.x));
    const spanY = Math.max(8, Math.abs(eastSouth.y - westNorth.y));
    const nextScale = clamp(Math.min(this.cssWidth / spanX, this.cssHeight / spanY) * 0.82, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const centerX = (westNorth.x + eastSouth.x) / 2;
    const centerY = (westNorth.y + eastSouth.y) / 2;
    this.viewport = normalizeMapViewport({
      scale: nextScale,
      offsetX: this.cssWidth / 2 - centerX * nextScale,
      offsetY: this.cssHeight / 2 - centerY * nextScale,
    }, this.cssWidth, this.cssHeight);
  }
}
