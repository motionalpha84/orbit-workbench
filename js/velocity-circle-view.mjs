import * as THREE from '../vendor/three.module.js';

const DEFAULT_RADIUS_KMS = 8;
const DEFAULT_SCENE_RADIUS = 2.8;
const MIN_CAMERA_DISTANCE = 2.2;
const MAX_CAMERA_DISTANCE = 12;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function vectorMagnitude(vector = {}) {
  const x = finiteNumber(vector.x);
  const y = finiteNumber(vector.y);
  const z = finiteNumber(vector.z);
  return Math.hypot(x, y, z);
}

function pointVelocity(point = {}) {
  return point.velocityKmS ?? point.velocity ?? point;
}

function collectVelocityPoints(track = {}) {
  return [
    track.current,
    ...(Array.isArray(track.samples) ? track.samples : []),
    ...(Array.isArray(track.trail) ? track.trail : []),
  ].filter(Boolean);
}

export function formatVelocityNumber(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return '--';
  return Number(value).toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
  });
}

export function velocityBounds(tracks = []) {
  let maxAbsComponent = 0;
  let maxSpeedKmS = 0;

  for (const track of Array.isArray(tracks) ? tracks : []) {
    for (const point of collectVelocityPoints(track)) {
      const velocity = pointVelocity(point);
      const components = [
        finiteNumber(velocity.x),
        finiteNumber(velocity.y),
        finiteNumber(velocity.z),
      ];
      maxAbsComponent = Math.max(maxAbsComponent, ...components.map((component) => Math.abs(component)));
      maxSpeedKmS = Math.max(maxSpeedKmS, finiteNumber(point.speedKmS, vectorMagnitude(velocity)));
    }
  }

  const radiusKmS = Math.max(maxSpeedKmS, maxAbsComponent, DEFAULT_RADIUS_KMS);
  return { maxAbsComponent, maxSpeedKmS, radiusKmS };
}

export function velocitySceneScale(bounds = {}) {
  const radiusKmS = finiteNumber(bounds.radiusKmS, DEFAULT_RADIUS_KMS);
  return DEFAULT_SCENE_RADIUS / Math.max(0.001, radiusKmS);
}

export function velocityVectorToScene(vector = {}, scale = 1) {
  const safeScale = finiteNumber(scale, 1);
  return new THREE.Vector3(
    finiteNumber(vector.x) * safeScale,
    finiteNumber(vector.z) * safeScale,
    -finiteNumber(vector.y) * safeScale,
  );
}

export function buildVelocityHitPayload(track, point = track?.current) {
  const velocity = pointVelocity(point);
  return {
    id: track?.id ?? '',
    name: track?.name ?? track?.id ?? '',
    color: track?.color ?? '#7fd1c7',
    elapsedSeconds: point?.elapsedSeconds,
    speedKmS: point?.speedKmS ?? vectorMagnitude(velocity),
    velocityKmS: {
      x: finiteNumber(velocity.x),
      y: finiteNumber(velocity.y),
      z: finiteNumber(velocity.z),
    },
    perturbationModel: point?.perturbationModel ?? track?.current?.perturbationModel ?? '',
  };
}

function velocityTooltipHtml(payload) {
  return `
    <strong>${escapeHtml(payload.name)}</strong>
    <dl>
      <dt>速度大小</dt><dd>${formatVelocityNumber(payload.speedKmS, 4)} km/s</dd>
      <dt>vx</dt><dd>${formatVelocityNumber(payload.velocityKmS.x, 4)} km/s</dd>
      <dt>vy</dt><dd>${formatVelocityNumber(payload.velocityKmS.y, 4)} km/s</dd>
      <dt>vz</dt><dd>${formatVelocityNumber(payload.velocityKmS.z, 4)} km/s</dd>
      <dt>仿真时刻</dt><dd>${formatVelocityNumber(payload.elapsedSeconds, 2)} s</dd>
      <dt>动力学</dt><dd>${escapeHtml(payload.perturbationModel)}</dd>
    </dl>
  `;
}

function colorFromHex(hex, fallback = '#7fd1c7') {
  return new THREE.Color(/^#[\da-f]{6}$/i.test(hex) ? hex : fallback);
}

export class VelocityCircleView {
  constructor({ canvas = null, tooltip = null, readout = null } = {}) {
    this.canvas = canvas ?? null;
    this.tooltip = tooltip ?? null;
    this.readout = readout ?? null;
    this.tracks = [];
    this.selectedIds = [];
    this.elapsedSeconds = 0;
    this.bounds = velocityBounds();
    this.scale = velocitySceneScale(this.bounds);
    this.isPanelOpen = false;
    this.isFullscreen = false;
    this.cameraTheta = Math.PI * 0.22;
    this.cameraPhi = Math.PI * 0.28;
    this.cameraDistance = 5.6;
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.pickTargets = [];

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);

    if (!this.canvas?.getContext || typeof window === 'undefined') return;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.045;
    this.pointer = new THREE.Vector2();
    this.root = new THREE.Group();
    this.axesRoot = new THREE.Group();
    this.trackRoot = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.axesRoot);
    this.root.add(this.trackRoot);
    this.scene.add(new THREE.AmbientLight(0xbfd9d6, 1.5));

    this.buildAxes();
    this.updateCamera();
    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    if (!this.canvas?.addEventListener) return;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', () => {
      this.onPointerUp({});
      this.hideTooltip();
    });
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  buildAxes() {
    if (!this.axesRoot) return;
    this.disposeObject(this.axesRoot);
    this.axesRoot.clear();
    const axes = [
      [{ x: 1, y: 0, z: 0 }, 0xb7d977],
      [{ x: 0, y: 1, z: 0 }, 0x62d6d0],
      [{ x: 0, y: 0, z: 1 }, 0xf2de79],
    ];
    for (const [direction, color] of axes) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        velocityVectorToScene(direction, DEFAULT_SCENE_RADIUS),
      ]);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
      });
      this.axesRoot.add(new THREE.Line(geometry, material));
    }
  }

  setPanelOpen(isPanelOpen) {
    const nextIsPanelOpen = Boolean(isPanelOpen);
    if (this.isPanelOpen === nextIsPanelOpen) return;
    this.isPanelOpen = nextIsPanelOpen;
    if (this.isPanelOpen) {
      this.resize();
    } else {
      this.hideTooltip();
    }
  }

  setFullscreen(isFullscreen) {
    const nextIsFullscreen = Boolean(isFullscreen);
    if (this.isFullscreen === nextIsFullscreen) return;
    this.isFullscreen = nextIsFullscreen;
    this.resize();
  }

  setData(tracks = [], options = {}) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    if (Array.isArray(options.selectedIds)) {
      this.selectedIds = [...new Set(options.selectedIds.filter(Boolean))];
    } else if ('selectedId' in options) {
      this.selectedIds = options.selectedId ? [options.selectedId] : [];
    }
    this.elapsedSeconds = finiteNumber(options.elapsedSeconds, this.elapsedSeconds);
    this.bounds = velocityBounds(this.tracks);
    this.scale = velocitySceneScale(this.bounds);
    if (this.trackRoot) this.rebuildTracks();
    this.render();
  }

  resize() {
    if (!this.renderer || !this.canvas || !this.camera) return false;
    const width = Math.round(this.canvas.clientWidth || this.canvas.width || 1);
    const height = Math.round(this.canvas.clientHeight || this.canvas.height || 1);
    if (width <= 0 || height <= 0) return false;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
    return true;
  }

  capturePng({ width = null, height = null } = {}) {
    if (!this.renderer || !this.canvas || !this.camera) return '';

    const previousSize = this.renderer.getSize?.(new THREE.Vector2()) ?? new THREE.Vector2(
      this.canvas.clientWidth || this.canvas.width || 1,
      this.canvas.clientHeight || this.canvas.height || 1,
    );
    const previousPixelRatio = this.renderer.getPixelRatio?.() ?? 1;
    const previousAspect = this.camera.aspect;
    const hasFixedSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

    if (hasFixedSize) {
      this.renderer.setPixelRatio?.(1);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    }

    this.render();
    const dataUrl = this.renderer.domElement?.toDataURL?.('image/png') ?? '';

    if (hasFixedSize) {
      this.renderer.setPixelRatio?.(previousPixelRatio);
      this.camera.aspect = previousAspect;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(previousSize.x, previousSize.y, false);
    }

    return dataUrl;
  }

  rebuildTracks() {
    if (!this.trackRoot) return;
    this.disposeObject(this.trackRoot);
    this.trackRoot.clear();
    this.pickTargets = [];

    const selected = new Set(this.selectedIds);
    const hasSelection = selected.size > 0;
    for (const track of this.tracks) {
      const isMuted = hasSelection && !selected.has(track.id);
      const referenceOpacity = isMuted ? 0.1 : 0.36;
      const trailOpacity = isMuted ? 0.24 : 0.72;

      const velocityHitPayload = buildVelocityHitPayload(track, track.current);
      const sampleLine = this.makeLine(track.samples ?? [], track.color, referenceOpacity, 1, velocityHitPayload);
      if (sampleLine) this.trackRoot.add(sampleLine);

      const trailLine = this.makeLine(track.trail ?? [], track.color, trailOpacity, 2, velocityHitPayload);
      if (trailLine) this.trackRoot.add(trailLine);

      const arrow = this.makeArrow(track);
      if (arrow) this.trackRoot.add(arrow);

      const endpoint = this.makeEndpoint(track);
      if (endpoint) this.trackRoot.add(endpoint);
    }
  }

  disposeObject(object) {
    object?.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  }

  makeLine(points, color, opacity, lineWidth = 1, velocityHitPayload = null) {
    const vectors = (Array.isArray(points) ? points : [])
      .map((point) => pointVelocity(point))
      .filter(Boolean)
      .map((vector) => velocityVectorToScene(vector, this.scale));
    if (vectors.length < 2) return null;

    const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
    const material = new THREE.LineBasicMaterial({
      color: colorFromHex(color),
      transparent: true,
      opacity,
      depthWrite: false,
      linewidth: lineWidth,
    });
    const line = new THREE.Line(geometry, material);
    if (velocityHitPayload) {
      line.userData.velocityHit = velocityHitPayload;
      this.pickTargets.push(line);
    }
    return line;
  }

  makeEndpoint(track) {
    if (!track?.current?.velocityKmS) return null;
    const payload = buildVelocityHitPayload(track, track.current);
    const endpoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 24, 16),
      new THREE.MeshBasicMaterial({
        color: colorFromHex(track.color),
        transparent: true,
        opacity: 0.95,
      }),
    );
    endpoint.position.copy(velocityVectorToScene(track.current.velocityKmS, this.scale));
    endpoint.userData.velocityHit = payload;
    this.pickTargets.push(endpoint);
    return endpoint;
  }

  makeArrow(track) {
    if (!track?.current?.velocityKmS) return null;
    const end = velocityVectorToScene(track.current.velocityKmS, this.scale);
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end]);
    const material = new THREE.LineBasicMaterial({
      color: colorFromHex(track.color),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const arrow = new THREE.Line(geometry, material);
    arrow.userData.velocityHit = buildVelocityHitPayload(track, track.current);
    this.pickTargets.push(arrow);
    return arrow;
  }

  updateCamera() {
    if (!this.camera) return;
    const phi = clamp(this.cameraPhi, 0.08, Math.PI - 0.08);
    this.cameraPhi = phi;
    const radius = clamp(this.cameraDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    this.cameraDistance = radius;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.cos(this.cameraTheta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(this.cameraTheta),
    );
    this.camera.lookAt(0, 0, 0);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault?.();
    this.isDragging = true;
    this.lastPointer = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    this.canvas?.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.renderer) return;
    if (this.isDragging) {
      event.preventDefault?.();
      const x = event.clientX ?? this.lastPointer.x;
      const y = event.clientY ?? this.lastPointer.y;
      const deltaX = x - this.lastPointer.x;
      const deltaY = y - this.lastPointer.y;
      this.lastPointer = { x, y };
      this.cameraTheta -= deltaX * 0.006;
      this.cameraPhi = clamp(this.cameraPhi + deltaY * 0.006, 0.08, Math.PI - 0.08);
      this.updateCamera();
      this.render();
      return;
    }
    this.updateHover(event);
  }

  onPointerUp(event) {
    this.isDragging = false;
    this.canvas?.releasePointerCapture?.(event.pointerId);
  }

  onWheel(event) {
    if (!this.renderer) return;
    event.preventDefault?.();
    this.cameraDistance = clamp(this.cameraDistance * Math.exp((event.deltaY ?? 0) * 0.001), MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    this.updateCamera();
    this.render();
  }

  updateHover(event) {
    if (!this.raycaster || !this.camera || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: this.canvas.clientWidth || 1,
      height: this.canvas.clientHeight || 1,
    };
    if (rect.width <= 0 || rect.height <= 0) return;

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster
      .intersectObjects(this.pickTargets, true)
      .find((item) => item.object.userData.velocityHit);

    if (hit?.object.userData.velocityHit) {
      this.showTooltip(hit.object.userData.velocityHit, event);
    } else {
      this.hideTooltip();
    }
  }

  showTooltip(payload, event) {
    const html = velocityTooltipHtml(payload);
    const rect = this.canvas?.getBoundingClientRect?.();
    const width = rect?.width ?? this.canvas?.clientWidth ?? this.canvas?.width ?? 0;
    const height = rect?.height ?? this.canvas?.clientHeight ?? this.canvas?.height ?? 0;
    const localX = rect ? (event.clientX ?? 0) - rect.left : (event.clientX ?? 0);
    const localY = rect ? (event.clientY ?? 0) - rect.top : (event.clientY ?? 0);
    const tooltipX = clamp(localX + 14, 8, Math.max(8, width - 280));
    const tooltipY = clamp(localY + 14, 8, Math.max(8, height - 148));
    if (this.tooltip) {
      this.tooltip.innerHTML = html;
      this.tooltip.style.borderColor = payload.color;
      this.tooltip.style.left = `${tooltipX}px`;
      this.tooltip.style.top = `${tooltipY}px`;
      this.tooltip.hidden = false;
    }
    if (this.readout) {
      this.readout.innerHTML = html;
      this.readout.hidden = false;
    }
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.hidden = true;
    if (this.readout) this.readout.hidden = true;
  }

  render() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }
}
