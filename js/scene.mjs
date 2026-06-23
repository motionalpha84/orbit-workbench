import * as THREE from '../vendor/three.module.js';

const EARTH_RADIUS_KM = 6378.137;
const EARTH_SCENE_RADIUS = 1;
const KM_TO_SCENE = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM;
const DEFAULT_TRAIL_POINTS = 130;
const REFERENCE_POINT_SPACING_SCENE = 0.028;
const MIN_REFERENCE_SAMPLES = 180;
const MAX_REFERENCE_SAMPLES = 2400;
const ECLIPTIC_OBLIQUITY_DEG = 23.439;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0.2, 2.0, 4.9);
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;
const SUPPORTED_PERTURBATION_MODELS = new Set(['two-body', 'j2', 'j3']);

export const EARTH_SIDEREAL_DAY_SECONDS = 86164.0905;

function normalizePerturbationModel(model) {
  return SUPPORTED_PERTURBATION_MODELS.has(model) ? model : 'two-body';
}

function colorFromHex(hex) {
  return new THREE.Color(hex);
}

function vectorToScene(positionKm) {
  return new THREE.Vector3(
    positionKm.x * KM_TO_SCENE,
    positionKm.z * KM_TO_SCENE,
    -positionKm.y * KM_TO_SCENE,
  );
}

function makeTextSprite(text, color = '#c8f7ff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 34px Consolas, monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.34, 0.13, 1);
  return sprite;
}

function createCircleLine(radius, color, opacity = 0.26) {
  const points = [];
  const segments = 192;
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
  });
  return new THREE.Line(geometry, material);
}

function createLineFromPoints(points, color, opacity = 0.14) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

function createEarthGraticule() {
  const group = new THREE.Group();
  const radius = EARTH_SCENE_RADIUS * 1.006;
  const segments = 160;

  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const latitudeRad = THREE.MathUtils.degToRad(latitude);
    const y = Math.sin(latitudeRad) * radius;
    const ringRadius = Math.cos(latitudeRad) * radius;
    const points = [];
    for (let index = 0; index <= segments; index += 1) {
      const theta = (index / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(theta) * ringRadius,
        y,
        Math.sin(theta) * ringRadius,
      ));
    }
    group.add(createLineFromPoints(points, 0x9bd8d0, latitude === 0 ? 0.24 : 0.12));
  }

  for (let longitude = 0; longitude < 180; longitude += 30) {
    const meridian = createCircleLine(radius, 0x9bd8d0, 0.12);
    meridian.rotation.z = Math.PI / 2;
    meridian.rotation.y = THREE.MathUtils.degToRad(longitude);
    group.add(meridian);
  }

  return group;
}

function createAxis(direction, color, label) {
  const group = new THREE.Group();
  const length = 2.75;
  const dir = direction.clone().normalize();
  const origin = new THREE.Vector3(0, 0, 0);
  const arrow = new THREE.ArrowHelper(dir, origin, length, color, 0.1, 0.045);
  group.add(arrow);
  const sprite = makeTextSprite(label, `#${new THREE.Color(color).getHexString()}`);
  sprite.position.copy(dir.multiplyScalar(length + 0.2));
  sprite.visible = false;
  group.add(sprite);
  arrow.line.userData.axisLabel = sprite;
  arrow.cone.userData.axisLabel = sprite;
  group.userData.axisLabel = sprite;
  group.userData.hoverTargets = [arrow.line, arrow.cone];
  return group;
}

function createTailGeometry(count) {
  const positions = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  return geometry;
}

function createTailMaterial(color) {
  const base = colorFromHex(color);
  const highlight = base.clone().lerp(new THREE.Color(0xffffff), 0.42);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: base },
      highlight: { value: highlight },
      size: { value: 26 },
      time: { value: 0 },
      focusOpacity: { value: 1 },
    },
    vertexShader: `
      attribute float alpha;
      attribute float phase;
      varying float vAlpha;
      varying float vPhase;
      uniform float size;
      void main() {
        vAlpha = alpha;
        vPhase = phase;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (0.52 + phase * 0.68) * (1.0 / max(0.4, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform vec3 highlight;
      uniform float time;
      uniform float focusOpacity;
      varying float vAlpha;
      varying float vPhase;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float radius = length(uv);
        float falloff = smoothstep(0.5, 0.0, radius);
        float core = smoothstep(0.32, 0.0, radius);
        float pulse = 0.86 + 0.14 * sin(time * 4.0 + vPhase * 13.0);
        vec3 mixedColor = mix(color, highlight, smoothstep(0.18, 1.0, vPhase) * (0.55 + core * 0.45));
        gl_FragColor = vec4(mixedColor, vAlpha * falloff * pulse * focusOpacity);
      }
    `,
  });
}

function createStarField() {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 34 + Math.random() * 46;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.set([
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    ], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xd7fff6,
    size: 0.035,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

export function projectPointerToArcball(x, y, width, height) {
  const diameter = Math.max(1, Math.min(width, height));
  const vector = new THREE.Vector3(
    (2 * x - width) / diameter,
    (height - 2 * y) / diameter,
    0,
  );
  const lengthSq = vector.x * vector.x + vector.y * vector.y;

  if (lengthSq <= 1) {
    vector.z = Math.sqrt(1 - lengthSq);
    return vector.normalize();
  }

  return vector.normalize();
}

export function arcballQuaternion(fromVector, toVector) {
  const from = fromVector.clone().normalize();
  const to = toVector.clone().normalize();
  const dot = THREE.MathUtils.clamp(from.dot(to), -1, 1);

  if (dot > 0.999999) return new THREE.Quaternion();

  if (dot < -0.999999) {
    const axis = Math.abs(from.x) < 0.9
      ? new THREE.Vector3(1, 0, 0).cross(from).normalize()
      : new THREE.Vector3(0, 1, 0).cross(from).normalize();
    return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
  }

  const axis = from.clone().cross(to);
  return new THREE.Quaternion(axis.x, axis.y, axis.z, 1 + dot).normalize();
}

export function cameraPanOffset(deltaX, deltaY, viewportHeight, cameraDistance, fovDegrees, cameraQuaternion) {
  const safeHeight = Math.max(1, viewportHeight);
  const safeDistance = Math.max(0.001, cameraDistance);
  const worldUnitsPerPixel = (2 * safeDistance * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2)) / safeHeight;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion).normalize();

  return right
    .multiplyScalar(-deltaX * worldUnitsPerPixel)
    .add(up.multiplyScalar(deltaY * worldUnitsPerPixel));
}

export function earthRotationAngleAt(elapsedSeconds) {
  const angle = (Number(elapsedSeconds) / EARTH_SIDEREAL_DAY_SECONDS) * TWO_PI;
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

export function frameAxesRotationAngleAt(frame, elapsedSeconds) {
  return frame === 'ECEF' ? earthRotationAngleAt(elapsedSeconds) : 0;
}

export function orbitReferenceSampleCount(orbit, maxSamples = MAX_REFERENCE_SAMPLES) {
  const a = orbit.elements.semiMajorAxisKm * KM_TO_SCENE;
  const b = a * Math.sqrt(1 - orbit.elements.eccentricity ** 2);
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const maximumSamples = Math.max(MIN_REFERENCE_SAMPLES, Math.floor(Number(maxSamples) || MAX_REFERENCE_SAMPLES));
  return THREE.MathUtils.clamp(
    Math.round(perimeter / REFERENCE_POINT_SPACING_SCENE),
    MIN_REFERENCE_SAMPLES,
    maximumSamples,
  );
}

class ArcballControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.rotateSpeed = 0.72;
    this.zoomSpeed = 1;
    this.minimumRadius = 0.08;
    this.isDragging = false;
    this.dragMode = null;
    this.lastArcballVector = new THREE.Vector3(0, 0, 1);
    this.lastPointerPosition = new THREE.Vector2();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);

    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.isDragging = true;
    this.dragMode = event.altKey ? 'pan' : 'rotate';
    this.lastPointerPosition.set(event.clientX, event.clientY);
    if (this.dragMode === 'rotate') this.lastArcballVector.copy(this.pointerToArcball(event));
    this.domElement.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.isDragging) return;
    event.preventDefault();

    if (event.altKey) {
      if (this.dragMode !== 'pan') {
        this.dragMode = 'pan';
        this.lastPointerPosition.set(event.clientX, event.clientY);
        return;
      }

      const deltaX = event.clientX - this.lastPointerPosition.x;
      const deltaY = event.clientY - this.lastPointerPosition.y;
      this.lastPointerPosition.set(event.clientX, event.clientY);
      this.panCamera(deltaX, deltaY);
      return;
    }

    if (this.dragMode !== 'rotate') {
      this.dragMode = 'rotate';
      this.lastArcballVector.copy(this.pointerToArcball(event));
      return;
    }

    const nextArcballVector = this.pointerToArcball(event);
    const localRotation = arcballQuaternion(nextArcballVector, this.lastArcballVector);
    this.lastArcballVector.copy(nextArcballVector);
    this.rotateCamera(localRotation);
  }

  onPointerUp(event) {
    this.isDragging = false;
    this.dragMode = null;
    this.domElement.releasePointerCapture?.(event.pointerId);
  }

  onWheel(event) {
    event.preventDefault();
    const offset = this.camera.position.clone().sub(this.target);
    const radius = Math.max(this.minimumRadius, offset.length() * Math.exp(event.deltaY * 0.001 * this.zoomSpeed));
    offset.setLength(radius);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  pointerToArcball(event) {
    const rect = this.domElement.getBoundingClientRect();
    return projectPointerToArcball(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  panCamera(deltaX, deltaY) {
    if (deltaX === 0 && deltaY === 0) return;
    const rect = this.domElement.getBoundingClientRect();
    const distance = this.camera.position.distanceTo(this.target);
    const panOffset = cameraPanOffset(deltaX, deltaY, rect.height, distance, this.camera.fov, this.camera.quaternion);
    this.camera.position.add(panOffset);
    this.target.add(panOffset);
    this.camera.lookAt(this.target);
  }

  rotateCamera(localRotation) {
    if (localRotation.equals(new THREE.Quaternion())) return;
    const offset = this.camera.position.clone().sub(this.target);
    const cameraRotation = this.camera.quaternion.clone();
    const worldRotation = cameraRotation.clone().multiply(localRotation).multiply(cameraRotation.clone().invert());

    offset.applyQuaternion(worldRotation);
    this.camera.up.applyQuaternion(worldRotation).normalize();
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  setView(position, up = DEFAULT_CAMERA_UP, target = new THREE.Vector3()) {
    this.target.copy(target);
    this.camera.up.copy(up);
    this.camera.position.copy(this.target).add(position);
    this.camera.lookAt(this.target);
  }

  update() {
    this.camera.lookAt(this.target);
  }
}

export class OrbitScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x071015, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x071015);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.01, 1000);
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);

    this.controls = new ArcballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 0.45;

    this.orbitGroups = new Map();
    this.showReference = true;
    this.elapsedSeconds = 0;
    this.frame = 'ECI';
    this.perturbationModel = 'two-body';
    this.maxReferenceSamples = MAX_REFERENCE_SAMPLES;
    this.axisLabels = [];
    this.axisHoverTargets = [];
    this.orbitHoverTargets = [];
    this.orbitHoverCallback = null;
    this.hoveredOrbitId = null;
    this.selectedOrbitIds = new Set();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.045;
    this.raycaster.params.Points.threshold = 0.08;
    this.pointer = new THREE.Vector2();

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.add(createStarField());

    this.createLighting();
    this.createEarth();
    this.createOverlays();
    this.bindAxisHover();
    this.resize();
  }

  createLighting() {
    this.scene.add(new THREE.AmbientLight(0x6c8798, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(3.8, 2.1, 4.2);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x69d6ff, 0.9);
    rim.position.set(-3.2, 1.1, -2.4);
    this.scene.add(rim);
  }

  createEarth() {
    this.earthBody = new THREE.Group();
    this.root.add(this.earthBody);

    const geometry = new THREE.SphereGeometry(EARTH_SCENE_RADIUS, 128, 96);
    const fallbackMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f6fb1,
      roughness: 0.74,
      metalness: 0.02,
      emissive: 0x082034,
      emissiveIntensity: 0.2,
    });
    this.earth = new THREE.Mesh(geometry, fallbackMaterial);
    this.earthBody.add(this.earth);

    const loader = new THREE.TextureLoader();
    loader.load(
      './assets/textures/earth_blue_marble_topo_5400.jpg',
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.86,
          metalness: 0.01,
          emissive: 0x06131a,
          emissiveIntensity: 0.12,
        });
        this.earth.material.dispose();
        this.earth.material = material;
      },
      undefined,
      () => {
        this.earth.add(createCircleLine(1.003, 0x8ddfff, 0.18));
      },
    );

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_RADIUS * 1.035, 96, 64),
      new THREE.MeshBasicMaterial({
        color: 0x4bc8ff,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.earthBody.add(glow);

    this.graticuleGroup = createEarthGraticule();
    this.earthBody.add(this.graticuleGroup);
  }

  createOverlays() {
    this.axesGroup = new THREE.Group();
    const axes = [
      createAxis(new THREE.Vector3(1, 0, 0), 0xff6b6b, 'x'),
      createAxis(new THREE.Vector3(0, 0, -1), 0x7ed957, 'y'),
      createAxis(new THREE.Vector3(0, 1, 0), 0x6ba8ff, 'z'),
    ];
    for (const axis of axes) {
      this.axisLabels.push(axis.userData.axisLabel);
      this.axisHoverTargets.push(...axis.userData.hoverTargets);
      this.axesGroup.add(axis);
    }
    this.root.add(this.axesGroup);

    this.eclipticGroup = new THREE.Group();
    const eclipticMesh = new THREE.Mesh(
      new THREE.CircleGeometry(EARTH_SCENE_RADIUS * 3.4, 192),
      new THREE.MeshBasicMaterial({
        color: 0xf2de79,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    eclipticMesh.rotation.x = Math.PI / 2 + THREE.MathUtils.degToRad(ECLIPTIC_OBLIQUITY_DEG);
    this.eclipticGroup.add(eclipticMesh);
    this.root.add(this.eclipticGroup);

    this.radiusGroup = new THREE.Group();
    const equatorMesh = new THREE.Mesh(
      new THREE.CircleGeometry(EARTH_SCENE_RADIUS * 1.45, 192),
      new THREE.MeshBasicMaterial({
        color: 0x8ddfff,
        transparent: true,
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    equatorMesh.rotation.x = Math.PI / 2;
    this.radiusGroup.add(equatorMesh);
    this.radiusGroup.add(createCircleLine(EARTH_SCENE_RADIUS * 1.45, 0x8ddfff, 0.16));
    this.root.add(this.radiusGroup);
  }

  bindAxisHover() {
    this.canvas.addEventListener('pointermove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);

      if (!this.axesGroup.visible) {
        this.setVisibleAxisLabel(null);
      } else {
        const axisHit = this.raycaster
          .intersectObjects(this.axisHoverTargets, true)
          .find((item) => item.object.userData.axisLabel);
        this.setVisibleAxisLabel(axisHit?.object.userData.axisLabel ?? null);
      }

      const orbitHit = this.raycaster
        .intersectObjects(this.orbitHoverTargets, true)
        .find((item) => {
          const orbitId = item.object.userData.orbitId;
          return orbitId && this.orbitGroups.get(orbitId)?.root.visible;
        });
      const orbitId = orbitHit?.object.userData.orbitId ?? null;
      if (orbitId === this.hoveredOrbitId) {
        if (orbitId && this.orbitHoverCallback) {
          const group = this.orbitGroups.get(orbitId);
          if (group) this.orbitHoverCallback({ orbitRecord: group.orbitRecord, clientX: event.clientX, clientY: event.clientY });
        }
        return;
      }
      this.hoveredOrbitId = orbitId;
      if (!this.orbitHoverCallback) return;
      if (!orbitId) {
        this.orbitHoverCallback(null);
        return;
      }
      const group = this.orbitGroups.get(orbitId);
      this.orbitHoverCallback(group ? { orbitRecord: group.orbitRecord, clientX: event.clientX, clientY: event.clientY } : null);
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.setVisibleAxisLabel(null);
      this.hoveredOrbitId = null;
      this.orbitHoverCallback?.(null);
    });
  }

  setVisibleAxisLabel(activeLabel) {
    for (const label of this.axisLabels) {
      label.visible = label === activeLabel;
    }
  }

  setOverlayVisibility({ axes, graticule, ecliptic, radius, reference }) {
    if (typeof axes === 'boolean') this.axesGroup.visible = axes;
    if (typeof graticule === 'boolean' && this.graticuleGroup) this.graticuleGroup.visible = graticule;
    if (typeof ecliptic === 'boolean') this.eclipticGroup.visible = ecliptic;
    if (typeof radius === 'boolean') this.radiusGroup.visible = radius;
    if (typeof reference === 'boolean') {
      this.showReference = reference;
      for (const group of this.orbitGroups.values()) {
        group.reference.visible = reference;
      }
    }
  }

  setOrbitHoverCallback(callback) {
    this.orbitHoverCallback = callback;
  }

  setFrame(frame) {
    this.frame = frame === 'ECEF' ? 'ECEF' : 'ECI';
    this.axesGroup.rotation.y = frameAxesRotationAngleAt(this.frame, this.elapsedSeconds);
  }

  setSelectedOrbits(ids = []) {
    this.selectedOrbitIds = new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);
    this.applyOrbitFocus();
  }

  setSelectedOrbit(id) {
    this.setSelectedOrbits(id ? [id] : []);
  }

  setPerformanceBudget(budget = {}) {
    const nextMaxReferenceSamples = Math.max(
      MIN_REFERENCE_SAMPLES,
      Math.floor(Number(budget.max3dReferenceSamples) || MAX_REFERENCE_SAMPLES),
    );
    if (nextMaxReferenceSamples === this.maxReferenceSamples) return;
    this.maxReferenceSamples = nextMaxReferenceSamples;
    for (const group of this.orbitGroups.values()) {
      group.referenceSignature = '';
    }
    this.syncOrbits(
      Array.from(this.orbitGroups.values()).map((group) => group.orbitRecord),
      this.perturbationModel,
    );
  }

  applyOrbitFocus() {
    const hasSelectedOrbit = Array.from(this.selectedOrbitIds).some((id) => this.orbitGroups.has(id));
    for (const group of this.orbitGroups.values()) {
      const isSelected = hasSelectedOrbit && this.selectedOrbitIds.has(group.orbitRecord.id);
      const isMuted = hasSelectedOrbit && !isSelected;
      group.reference.material.opacity = isSelected ? 0.5 : isMuted ? 0.09 : 0.28;
      group.tail.material.uniforms.focusOpacity.value = isSelected ? 1.25 : isMuted ? 0.32 : 1;
      group.marker.material.opacity = isMuted ? 0.5 : 1;
      group.marker.material.emissiveIntensity = isSelected ? 1.45 : isMuted ? 0.28 : 0.9;
      group.marker.scale.setScalar(isSelected ? 1.24 : isMuted ? 0.78 : 1);
    }
  }

  setView(view) {
    const currentRadius = Math.max(this.camera.position.distanceTo(this.controls.target), DEFAULT_CAMERA_POSITION.length());
    if (view === 'front') {
      this.controls.setView(new THREE.Vector3(currentRadius, 0, 0), DEFAULT_CAMERA_UP);
      return;
    }
    if (view === 'top') {
      this.controls.setView(new THREE.Vector3(0, currentRadius, 0), new THREE.Vector3(0, 0, -1));
      return;
    }
    this.controls.setView(DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_UP);
  }

  syncOrbits(orbits, perturbationModel = this.perturbationModel) {
    const model = normalizePerturbationModel(perturbationModel);
    this.perturbationModel = model;
    const activeIds = new Set(orbits.map((orbit) => orbit.id));
    for (const [id, group] of this.orbitGroups.entries()) {
      if (!activeIds.has(id)) {
        this.root.remove(group.root);
        disposeObject(group.root);
        this.orbitGroups.delete(id);
      }
    }

    for (const orbitRecord of orbits) {
      if (!this.orbitGroups.has(orbitRecord.id)) {
        this.orbitGroups.set(orbitRecord.id, this.createOrbitGroup(orbitRecord, model));
      }
      const group = this.orbitGroups.get(orbitRecord.id);
      group.orbitRecord = orbitRecord;
      group.root.visible = orbitRecord.visible;
      group.reference.visible = orbitRecord.visible && this.showReference;
    }
    this.orbitHoverTargets = Array.from(this.orbitGroups.values())
      .flatMap((group) => [group.reference, group.tail, group.marker]);
    this.applyOrbitFocus();
  }

  createOrbitGroup(orbitRecord, perturbationModel = this.perturbationModel) {
    const root = new THREE.Group();
    const color = orbitRecord.color;
    root.userData.orbitId = orbitRecord.id;

    const referenceMaterial = new THREE.PointsMaterial({
      color: colorFromHex(color),
      size: 0.018,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const reference = new THREE.Points(new THREE.BufferGeometry(), referenceMaterial);
    reference.userData.orbitId = orbitRecord.id;
    root.add(reference);

    const tailGeometry = createTailGeometry(DEFAULT_TRAIL_POINTS);
    const tailMaterial = createTailMaterial(color);
    const tail = new THREE.Points(tailGeometry, tailMaterial);
    tail.userData.orbitId = orbitRecord.id;
    root.add(tail);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 24, 16),
      new THREE.MeshStandardMaterial({
        color: colorFromHex(color),
        emissive: colorFromHex(color),
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 1,
        roughness: 0.35,
      }),
    );
    marker.userData.orbitId = orbitRecord.id;
    root.add(marker);

    this.root.add(root);
    const group = { root, reference, tail, marker, orbitRecord, referenceSignature: '' };
    return group;
  }

  updateOrbitReference(group, referencePoints = []) {
    const positions = new Float32Array(referencePoints.length * 3);
    referencePoints.forEach((sample, index) => {
      const point = sample.scenePoint
        ? new THREE.Vector3(sample.scenePoint.x, sample.scenePoint.y, sample.scenePoint.z)
        : vectorToScene(sample.positionKm);
      positions.set([point.x, point.y, point.z], index * 3);
    });

    const referenceGeometry = new THREE.BufferGeometry();
    referenceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    group.reference.geometry.dispose();
    group.reference.geometry = referenceGeometry;
  }

  update(orbits, elapsedSeconds, perturbationModel = this.perturbationModel) {
    this.elapsedSeconds = elapsedSeconds;
    this.perturbationModel = normalizePerturbationModel(perturbationModel);
    this.earthBody.rotation.y = earthRotationAngleAt(elapsedSeconds);
    this.axesGroup.rotation.y = frameAxesRotationAngleAt(this.frame, elapsedSeconds);
    this.syncOrbits(orbits, this.perturbationModel);
    this.controls.update();
    this.render();
  }

  applyRenderData(renderData = {}) {
    this.elapsedSeconds = Number(renderData.elapsedSeconds) || 0;
    this.perturbationModel = normalizePerturbationModel(renderData.perturbationModel);
    this.earthBody.rotation.y = Number(renderData.earthRotationAngleRad) || earthRotationAngleAt(this.elapsedSeconds);
    this.axesGroup.rotation.y = Number(renderData.frameAxesRotationAngleRad) || frameAxesRotationAngleAt(this.frame, this.elapsedSeconds);
    const renderOrbits = Array.isArray(renderData.orbits) ? renderData.orbits : [];
    const shellRecords = renderOrbits.map((orbit) => ({
      id: orbit.id,
      name: orbit.name,
      color: orbit.color,
      visible: orbit.visible !== false,
      orbit: { elements: {}, periodSeconds: 1 },
    }));
    this.syncOrbits(shellRecords, this.perturbationModel);
    for (const orbitRenderData of renderOrbits) {
      const group = this.orbitGroups.get(orbitRenderData.id);
      if (!group || orbitRenderData.visible === false) continue;
      this.applyOrbitRenderData(group, orbitRenderData);
    }
    this.controls.update();
    this.render();
  }

  applyOrbitRenderData(group, orbitRenderData) {
    this.updateOrbitReference(group, orbitRenderData.referencePoints ?? []);
    const tailSamples = orbitRenderData.tailSamples ?? [];
    const positions = group.tail.geometry.getAttribute('position');
    const alphas = group.tail.geometry.getAttribute('alpha');
    const phases = group.tail.geometry.getAttribute('phase');
    group.tail.material.uniforms.time.value = this.elapsedSeconds;

    for (let i = 0; i < DEFAULT_TRAIL_POINTS; i += 1) {
      const sample = tailSamples[Math.min(i, Math.max(0, tailSamples.length - 1))];
      const scenePoint = sample?.scenePoint ?? { x: 0, y: 0, z: 0 };
      positions.setXYZ(i, scenePoint.x, scenePoint.y, scenePoint.z);
      alphas.setX(i, orbitRenderData.visible === false ? 0 : Number(sample?.alpha ?? 0));
      phases.setX(i, Number(sample?.phase ?? 0));
    }
    positions.needsUpdate = true;
    alphas.needsUpdate = true;
    phases.needsUpdate = true;

    const currentPoint = orbitRenderData.current?.scenePoint;
    if (currentPoint) group.marker.position.set(currentPoint.x, currentPoint.y, currentPoint.z);
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  capturePng() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }
}

export { KM_TO_SCENE, vectorToScene };
