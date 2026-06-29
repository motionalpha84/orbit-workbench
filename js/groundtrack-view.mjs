const DEFAULT_MAP_SRC = './assets/maps/dark-world-map.svg';
const MIN_VIEW_SCALE = 1;
const MAX_VIEW_SCALE = 18;

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
  } = {}) {
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
      if (!this.dragMode) this.hideTooltip();
      this.draw();
    });
  }

  setRegionSelectedCallback(callback) {
    this.onRegionSelected = callback;
  }

  setData(tracks = [], options = {}) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    if (Array.isArray(options.selectedIds)) {
      this.selectedIds = [...new Set(options.selectedIds.filter(Boolean))];
    } else if ('selectedId' in options) {
      this.selectedIds = options.selectedId ? [options.selectedId] : [];
    }
    this.elapsedSeconds = finiteNumber(options.elapsedSeconds, this.elapsedSeconds);
    this.isPlaying = Boolean(options.isPlaying);
    this.draw();
  }

  setOptions(options = {}) {
    this.options = { ...this.options, ...options };
    this.draw();
  }

  setPanelOpen(isPanelOpen) {
    this.isPanelOpen = Boolean(isPanelOpen);
    if (this.isPanelOpen) {
      this.resize();
      this.draw();
    }
  }

  setFullscreen(isFullscreen) {
    this.isFullscreen = Boolean(isFullscreen);
    this.resize();
    this.draw();
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
    this.drawBaseMap(targetCtx);
    this.drawGrid(targetCtx);
    this.drawTracks(targetCtx);
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
    this.drawBaseMap(ctx);
    this.drawGrid(ctx);
    this.drawTracks(ctx);
    this.drawCursorGuides(ctx);
    this.drawSelection(ctx);
  }

  drawBaseMap(ctx) {
    ctx.save();
    ctx.fillStyle = '#061015';
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
      gradient.addColorStop(0, '#071015');
      gradient.addColorStop(0.55, '#0b1a1d');
      gradient.addColorStop(1, '#061116');
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
    ctx.fillStyle = 'rgba(23, 53, 58, 0.86)';
    ctx.strokeStyle = 'rgba(138, 196, 187, 0.38)';
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
      ? 'rgba(150, 190, 184, 0.23)'
      : 'rgba(150, 190, 184, 0.16)';
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
    ctx.strokeStyle = this.options.highlightEquator ? 'rgba(242, 222, 121, 0.58)' : 'rgba(242, 222, 121, 0.22)';
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
    ctx.strokeStyle = 'rgba(124, 179, 136, 0.42)';
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

    this.drawTrackSegmentGroup(ctx, pastSegments, {
      color: track.color,
      alpha: 0.24 * opacityScale,
      lineWidth: 1.45,
    });
    this.drawTrackSegmentGroup(ctx, currentSegments, {
      color: track.color,
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
    ctx.fillStyle = colorWithAlpha(track.color, 0.95);
    ctx.strokeStyle = colorWithAlpha(track.color, 0.26);
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
    ctx.fillStyle = 'rgba(86, 140, 135, 0.12)';
    ctx.strokeStyle = 'rgba(124, 179, 136, 0.82)';
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
    const hit = this.findNearestTrackPoint(point);
    if (hit) this.showTooltip(hit, point);
    else this.hideTooltip();
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
        this.zoomToBounds(bounds);
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
