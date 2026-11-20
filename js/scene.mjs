import * as THREE from '../vendor/three.module.js';
import { EARTH_RADIUS_KM, normalizePerturbationModel } from './orbit.mjs';
import { OrbitBatchRenderer, ORBIT_BATCH_THRESHOLD } from './orbit-batch.mjs';
import { displayColorOnLight } from './color.mjs';

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

export const EARTH_SIDEREAL_DAY_SECONDS = 86164.0905;

// 'dark' is the v2.1 deep-space look. 'light' is the V2.2 Firefly stage: the canvas clears
// transparent so the frosted stage shows through, glows use normal blending (additive light
// vanishes on a pale field), and reference lines, planes and axes are re-tinted for contrast.
const THEMES = {
  dark: {
    clear: 0x0a0d14, clearAlpha: 1, additive: true, glow: 0x38f8b8, glowAlpha: 0.2,
    axes: [0xff6b6b, 0x7ed957, 0x6ba8ff], ecliptic: [0xd8c68d, 0.026], equator: [0x7dcacb, 0.024],
    equatorRing: [0x8ddfff, 0.16], stars: { size: 0.16, opacity: 0.66, tint: null }, focusOpacity: [0.9, 0.38, 0.68],
  },
  light: {
    clear: 0xe9f0ef, clearAlpha: 0, additive: false, glow: 0x3fb5a3, glowAlpha: 0.42,
    axes: [0xd4553a, 0x3e9a4a, 0x3a6fd0], ecliptic: [0xc9a040, 0.1], equator: [0x2f9aa0, 0.08],
    equatorRing: [0x2f8fa0, 0.42], stars: { size: 0.09, opacity: 0.3, tint: 0x4a5f64 }, focusOpacity: [0.95, 0.42, 0.8],
  },
};


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

function isFiniteVector(vector = {}) {
  if (!vector || typeof vector !== 'object') return false;
  return Number.isFinite(Number(vector.x))
    && Number.isFinite(Number(vector.y))
    && Number.isFinite(Number(vector.z));
}

export function normalizeCalibrationMarkers(markers = []) {
  if (!Array.isArray(markers)) return [];
  return markers
    .filter((marker) => marker?.orbitId && isFiniteVector(marker.positionKm))
    .map((marker) => {
      const positionKm = {
        x: Number(marker.positionKm.x),
        y: Number(marker.positionKm.y),
        z: Number(marker.positionKm.z),
      };
      return {
        targetId: marker.targetId || '',
        targetName: marker.targetName || '未命名标定',
        targetMode: marker.targetMode === 'velocity' ? 'velocity' : 'position',
        orbitId: marker.orbitId,
        orbitName: marker.orbitName || '未命名轨道',
        color: marker.color || '#8bbfba',
        positionKm,
        scenePosition: vectorToScene(positionKm),
        residual: Number.isFinite(Number(marker.residual)) ? Number(marker.residual) : 0,
        elapsedSeconds: Number.isFinite(Number(marker.elapsedSeconds)) ? Number(marker.elapsedSeconds) : 0,
        visible: marker.visible !== false,
      };
    });
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

// Keep the reference planes in their physical orientation while fading their
// fill before the mesh boundary. A constant alpha exposed a large hard disc.
function createReferencePlaneMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      planeColor: { value: new THREE.Color(color) },
      planeOpacity: { value: opacity },
    },
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      varying vec2 vPlaneUv;
      void main() {
        vPlaneUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 planeColor;
      uniform float planeOpacity;
      varying vec2 vPlaneUv;
      void main() {
        float radius = length(vPlaneUv * 2.0 - 1.0);
        float fade = 1.0 - smoothstep(0.12, 0.98, radius);
        float alpha = planeOpacity * fade * fade;
        if (alpha < 0.00001) discard;
        gl_FragColor = vec4(planeColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
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

function createTailMaterial(color, additive = true) {
  const base = colorFromHex(color);
  const highlight = base.clone().lerp(new THREE.Color(0xffffff), 0.42);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
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

function createStarField(look = THEMES.dark.stars) {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 0x7a6f1;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const starColors = [new THREE.Color(0xc8dce9), new THREE.Color(0xe9eef4), new THREE.Color(0xe2c390)];
  for (let i = 0; i < count; i += 1) {
    const radius = 34 + random() * 46;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions.set([
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    ], i * 3);
    (look.tint === null ? starColors[i % 11 === 0 ? 2 : i % 2] : new THREE.Color(look.tint)).toArray(colors, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    size: look.size,
    transparent: true,
    opacity: look.opacity,
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

function orbitReferenceSignature(orbitRecord, perturbationModel) {
  const elements = orbitRecord.orbit.elements;
  return [
    normalizePerturbationModel(perturbationModel),
    elements.semiMajorAxisKm,
    elements.eccentricity,
    elements.inclinationDeg,
    elements.raanDeg,
    elements.argPeriapsisDeg,
    elements.trueAnomalyDeg,
  ].join('|');
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
  constructor(canvas, { theme = 'dark' } = {}) {
    this.canvas = canvas;
    this.themeName = THEMES[theme] ? theme : 'dark';
    this.theme = THEMES[this.themeName];
    const transparent = this.theme.clearAlpha < 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(this.palette.clear, this.palette.clearAlpha);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.scene.background = transparent ? null : new THREE.Color(this.palette.clear);

    this.camera = new THREE.PerspectiveCamera(39, 1, 0.01, 1000);
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);

    this.controls = new ArcballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 0.45;

    this.orbitGroups = new Map();
    this.orbitBatch = null;
    this.batchThreshold = ORBIT_BATCH_THRESHOLD;
    this.computedRecords = new Map();
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
    this.calibrationMarkerGroup = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.calibrationMarkerGroup);
    this.scene.add(createStarField(this.palette.stars));

    this.createLighting();
    this.createEarth();
    this.createOverlays();
    this.bindAxisHover();
    this.resize();
  }

  createLighting() {
    this.scene.add(new THREE.AmbientLight(0xa8bfd0, 1.35));
    const sun = new THREE.DirectionalLight(0xf3f6f8, 2.15);
    sun.position.set(-4, 3, 5);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x70d3c0, 0.55);
    rim.position.set(-3.2, 1.1, -2.4);
    this.scene.add(rim);
  }

  createEarth() {
    this.earthBody = new THREE.Group();
    this.root.add(this.earthBody);

    const geometry = new THREE.SphereGeometry(EARTH_SCENE_RADIUS, 128, 96);
    const fallbackMaterial = new THREE.MeshStandardMaterial({
      color: 0x506c82,
      roughness: 0.74,
      metalness: 0.02,
      emissive: 0x0b1819,
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
          color: 0xd2dde4,
          roughness: 0.82,
          metalness: 0.01,
          emissive: 0x091516,
          emissiveIntensity: 0.12,
        });
        material.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            float grayEarth = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            diffuseColor.rgb = mix(vec3(grayEarth), diffuseColor.rgb, 0.52) * vec3(0.84, 0.93, 1.0);
            diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.88));`);
        };
        this.earth.material.dispose();
        this.earth.material = material;
      },
      undefined,
      () => {
        this.earth.add(createCircleLine(1.003, 0x8ddfc9, 0.18));
      },
    );

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_RADIUS * 1.035, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(this.palette.glow) }, glowAlpha: { value: this.palette.glowAlpha } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vPosition = world.xyz;
            vNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: `
          uniform vec3 glowColor;
          uniform float glowAlpha;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vec3 direction = normalize(cameraPosition - vPosition);
            float facing = abs(dot(normalize(vNormal), direction));
            float fresnel = pow(1.0 - facing, 3.0);
            float softEdge = smoothstep(0.0, 0.28, facing);
            gl_FragColor = vec4(glowColor, fresnel * softEdge * glowAlpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: true, blending: this.palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false, side: THREE.BackSide,
      }),
    );
    this.earthBody.add(glow);

    this.graticuleGroup = createEarthGraticule();
    this.earthBody.add(this.graticuleGroup);
  }

  createOverlays() {
    this.axesGroup = new THREE.Group();
    const axes = [
      createAxis(new THREE.Vector3(1, 0, 0), this.palette.axes[0], 'x'),
      createAxis(new THREE.Vector3(0, 0, -1), this.palette.axes[1], 'y'),
      createAxis(new THREE.Vector3(0, 1, 0), this.palette.axes[2], 'z'),
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
      createReferencePlaneMaterial(...this.palette.ecliptic),
    );
    eclipticMesh.rotation.x = Math.PI / 2 + THREE.MathUtils.degToRad(ECLIPTIC_OBLIQUITY_DEG);
    this.eclipticGroup.add(eclipticMesh);
    this.root.add(this.eclipticGroup);

    this.radiusGroup = new THREE.Group();
    const equatorMesh = new THREE.Mesh(
      new THREE.CircleGeometry(EARTH_SCENE_RADIUS * 1.45, 192),
      createReferencePlaneMaterial(...this.palette.equator),
    );
    equatorMesh.rotation.x = Math.PI / 2;
    this.radiusGroup.add(equatorMesh);
    this.radiusGroup.add(createCircleLine(EARTH_SCENE_RADIUS * 1.45, ...this.palette.equatorRing));
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

      let orbitId = null;
      if (this.orbitBatch) {
        orbitId = this.orbitBatch.pick(this.raycaster.ray, this.raycaster.params.Points.threshold)?.id ?? null;
      } else {
        const orbitHit = this.raycaster
          .intersectObjects(this.orbitHoverTargets, true)
          .find((item) => {
            const id = item.object.userData.orbitId;
            return item.object.visible && id && this.orbitGroups.get(id)?.root.visible;
          });
        orbitId = orbitHit?.object.userData.orbitId ?? null;
      }
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
      if (this.orbitBatch) this.orbitBatch.parts.reference.object.visible = reference;
      else for (const group of this.orbitGroups.values()) group.reference.visible = reference;
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
    this.maxReferenceSamples = nextMaxReferenceSamples;
  }

  applyOrbitFocus() {
    if (this.orbitBatch) {
      this.orbitBatch.setFocus(this.selectedOrbitIds);
      return;
    }
    const hasSelectedOrbit = Array.from(this.selectedOrbitIds).some((id) => this.orbitGroups.has(id));
    for (const group of this.orbitGroups.values()) {
      const isSelected = hasSelectedOrbit && this.selectedOrbitIds.has(group.orbitRecord.id);
      const isMuted = hasSelectedOrbit && !isSelected;
      const [selectedOpacity, mutedOpacity, idleOpacity] = this.palette.focusOpacity;
      group.reference.material.opacity = isSelected ? selectedOpacity : isMuted ? mutedOpacity : idleOpacity;
      group.tail.material.uniforms.focusOpacity.value = isSelected ? 1.35 : isMuted ? 0.65 : 1.1;
      group.marker.material.opacity = isMuted ? 0.82 : 1;
      group.marker.material.emissiveIntensity = isSelected ? 1.6 : isMuted ? 0.7 : 1.1;
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
    if (orbits.length >= (this.batchThreshold ?? ORBIT_BATCH_THRESHOLD)) {
      this.syncBatchedOrbits(orbits, model);
      return;
    }
    if (this.orbitBatch) {
      for (const orbitRecord of orbits) {
        const previous = this.orbitGroups.get(orbitRecord.id);
        if (previous?.referenceSignature !== orbitReferenceSignature(orbitRecord, model)) this.computedRecords.delete(orbitRecord.id);
      }
      this.root.remove(this.orbitBatch.root);
      this.orbitBatch.dispose();
      this.orbitBatch = null;
      this.orbitGroups.clear();
    }
    const activeIds = new Set(orbits.map((orbit) => orbit.id));
    for (const [id, group] of this.orbitGroups.entries()) {
      if (!activeIds.has(id)) {
        this.root.remove(group.root);
        disposeObject(group.root);
        this.orbitGroups.delete(id);
        this.computedRecords.delete(id);
      }
    }

    for (const orbitRecord of orbits) {
      if (!this.orbitGroups.has(orbitRecord.id)) {
        this.orbitGroups.set(orbitRecord.id, this.createOrbitGroup(orbitRecord, model));
      }
      const group = this.orbitGroups.get(orbitRecord.id);
      group.orbitRecord = orbitRecord;
      this.updateOrbitReference(group, orbitRecord, model);
      if (group.color !== orbitRecord.color) {
        group.color = orbitRecord.color;
        const color = colorFromHex(this.displayColor(orbitRecord.color));
        group.reference.material.color.copy(color);
        group.tail.material.uniforms.color.value.copy(color);
        group.tail.material.uniforms.highlight.value.copy(color).lerp(new THREE.Color(0xffffff), 0.42);
        group.marker.material.color.copy(color);
        group.marker.material.emissive.copy(color);
      }
      group.root.visible = orbitRecord.visible;
      group.reference.visible = orbitRecord.visible && this.showReference;
    }
    this.orbitHoverTargets = Array.from(this.orbitGroups.values())
      .flatMap((group) => [group.reference, group.tail, group.marker]);
    this.applyOrbitFocus();
  }

  syncBatchedOrbits(orbits, model) {
    if (!this.orbitBatch) {
      // Individual GPU objects are released when crossing the batch threshold.
      // Latest authoritative frames remain available during both transitions.
      const signatures = new Map([...this.orbitGroups].map(([id, group]) => [id, group.referenceSignature]));
      for (const group of this.orbitGroups.values()) {
        this.root.remove(group.root);
        disposeObject(group.root);
      }
      this.orbitGroups.clear();
      for (const orbitRecord of orbits) {
        const signature = signatures.get(orbitRecord.id);
        if (signature && signature !== orbitReferenceSignature(orbitRecord, model)) this.computedRecords.delete(orbitRecord.id);
      }
      this.orbitBatch = new OrbitBatchRenderer({ additive: this.palette.additive, displayColor: (hex) => this.displayColor(hex) });
      this.root.add(this.orbitBatch.root);
      this.orbitBatch.setViewport(this.canvas?.clientHeight || 800, this.renderer?.getPixelRatio() || 1);
    }
    const activeIds = new Set(orbits.map((record) => record.id));
    for (const id of this.computedRecords.keys()) if (!activeIds.has(id)) this.computedRecords.delete(id);
    const metadata = new Map();
    for (const orbitRecord of orbits) {
      const signature = orbitReferenceSignature(orbitRecord, model);
      const previous = this.orbitGroups.get(orbitRecord.id);
      if (previous?.referenceSignature && previous.referenceSignature !== signature) this.computedRecords.delete(orbitRecord.id);
      metadata.set(orbitRecord.id, { orbitRecord, root: { visible: orbitRecord.visible !== false }, referenceSignature: signature });
    }
    this.orbitGroups = metadata;
    this.orbitBatch.setRecords(orbits, this.selectedOrbitIds, this.showReference);
    this.orbitBatch.updateFrame(this.computedRecords, this.elapsedSeconds);
    this.orbitHoverTargets = [];
  }

  // Theme lookups fall back to the v2.1 dark look for scenes built without the constructor.
  get palette() {
    return this.theme ?? THEMES.dark;
  }

  // Pale orbit colours are darkened for drawing on the light stage (stored colours unchanged).
  displayColor(hex) {
    return this.themeName === 'light' ? displayColorOnLight(hex) : hex;
  }

  createOrbitGroup(orbitRecord, perturbationModel = this.perturbationModel) {
    const root = new THREE.Group();
    const color = orbitRecord.color;
    const shown = this.displayColor(color);
    root.userData.orbitId = orbitRecord.id;

    const referenceMaterial = new THREE.LineBasicMaterial({
      color: colorFromHex(shown),
      transparent: true,
      opacity: this.palette.focusOpacity[2],
      depthWrite: false,
      blending: this.palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Connect the same authoritative samples for readable individual paths;
    // large datasets retain the lower-opacity batched point representation.
    const reference = new THREE.Line(new THREE.BufferGeometry(), referenceMaterial);
    reference.userData.orbitId = orbitRecord.id;
    root.add(reference);

    const tailGeometry = createTailGeometry(DEFAULT_TRAIL_POINTS);
    const tailMaterial = createTailMaterial(shown, this.palette.additive);
    const tail = new THREE.Points(tailGeometry, tailMaterial);
    tail.visible = false;
    tail.userData.orbitId = orbitRecord.id;
    root.add(tail);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 24, 16),
      new THREE.MeshStandardMaterial({
        color: colorFromHex(shown),
        emissive: colorFromHex(shown),
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 1,
        roughness: 0.35,
      }),
    );
    marker.userData.orbitId = orbitRecord.id;
    marker.visible = false;
    root.add(marker);

    this.root.add(root);
    const group = { root, reference, tail, marker, orbitRecord, color, referenceSignature: '', referenceSource: null };
    this.updateOrbitReference(group, orbitRecord, perturbationModel);
    const computed = this.computedRecords.get(orbitRecord.id);
    if (computed) this.updateOrbitGroup(group, computed, this.elapsedSeconds);
    return group;
  }

  updateOrbitReference(group, orbitRecord, perturbationModel = this.perturbationModel) {
    const signature = orbitReferenceSignature(orbitRecord, perturbationModel);
    const source = orbitRecord.reference;
    if (group.referenceSignature === signature && group.referenceSource === source) return;
    if (group.referenceSignature && group.referenceSignature !== signature) {
      group.marker.visible = false;
      group.tail.visible = false;
      this.computedRecords.delete(orbitRecord.id);
    }

    const samples = Array.isArray(source) ? source.filter((sample) => isFiniteVector(sample?.positionKm)) : [];
    const positions = new Float32Array(samples.length * 3);
    samples.forEach((sample, index) => {
      const point = vectorToScene(sample.positionKm);
      positions.set([point.x, point.y, point.z], index * 3);
    });

    const referenceGeometry = new THREE.BufferGeometry();
    referenceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (samples.length > 0) referenceGeometry.computeBoundingSphere();
    group.reference.geometry.dispose();
    group.reference.geometry = referenceGeometry;
    group.referenceSignature = signature;
    group.referenceSource = source;
  }

  // The backend owns orbital propagation. Only authoritative returned samples
  // enter the scene; a disconnected backend leaves the last frame visible.
  setComputedFrame(frame) {
    this.computedRecords = new Map((frame?.records ?? []).map((record) => [record.id, record]));
    if (Number.isFinite(frame?.elapsedSeconds)) this.elapsedSeconds = frame.elapsedSeconds;
    if (this.orbitBatch) {
      this.orbitBatch.updateFrame(this.computedRecords, this.elapsedSeconds);
      return;
    }
    for (const [id, group] of this.orbitGroups) {
      const computed = this.computedRecords.get(id);
      if (computed) this.updateOrbitGroup(group, computed, this.elapsedSeconds);
      else {
        group.marker.visible = false;
        group.tail.visible = false;
      }
    }
  }

  update(orbits, elapsedSeconds, perturbationModel = this.perturbationModel) {
    this.elapsedSeconds = elapsedSeconds;
    this.perturbationModel = normalizePerturbationModel(perturbationModel);
    this.earthBody.rotation.y = earthRotationAngleAt(elapsedSeconds);
    this.axesGroup.rotation.y = frameAxesRotationAngleAt(this.frame, elapsedSeconds);
    if (this.orbitBatch) this.orbitBatch.setTime(elapsedSeconds);
    else for (const group of this.orbitGroups.values()) {
      if (group.root.visible) group.tail.material.uniforms.time.value = elapsedSeconds;
    }
    this.controls.update();
    this.render();
  }

  updateOrbitGroup(group, computed, elapsedSeconds) {
    const current = computed.state?.positionKm;
    group.marker.visible = isFiniteVector(current);
    if (group.marker.visible) group.marker.position.copy(vectorToScene(current));
    const trail = Array.isArray(computed.trail) ? computed.trail.filter(isFiniteVector) : [];
    group.tail.visible = trail.length > 0;
    if (trail.length > group.tail.geometry.getAttribute('position').count) {
      group.tail.geometry.dispose();
      group.tail.geometry = createTailGeometry(trail.length);
    }
    const positions = group.tail.geometry.getAttribute('position');
    const alphas = group.tail.geometry.getAttribute('alpha');
    const phases = group.tail.geometry.getAttribute('phase');
    group.tail.material.uniforms.time.value = elapsedSeconds;

    for (let i = 0; i < trail.length; i += 1) {
      const point = trail[i];
      positions.setXYZ(i, point.x * KM_TO_SCENE, point.z * KM_TO_SCENE, -point.y * KM_TO_SCENE);
      const fade = trail.length > 1 ? i / (trail.length - 1) : 1;
      alphas.setX(i, 0.03 + fade ** 1.35 * 0.84);
      phases.setX(i, fade);
    }
    positions.needsUpdate = true;
    alphas.needsUpdate = true;
    phases.needsUpdate = true;
    group.tail.geometry.setDrawRange(0, trail.length);
    if (trail.length > 0) group.tail.geometry.computeBoundingSphere();
  }

  clearCalibrationMarkers() {
    for (const child of [...this.calibrationMarkerGroup.children]) {
      this.calibrationMarkerGroup.remove(child);
      disposeObject(child);
    }
  }

  createCalibrationMarker(marker) {
    const group = new THREE.Group();
    group.position.copy(marker.scenePosition);
    group.visible = marker.visible !== false;
    group.userData.calibrationMarker = marker;

    const color = colorFromHex(this.displayColor(marker.color));
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.034, 28, 18),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.96,
        roughness: 0.28,
      }),
    );
    group.add(core);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.058, 0.0045, 8, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: this.palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    return group;
  }

  setCalibrationMarkers(markers = []) {
    this.clearCalibrationMarkers();
    for (const marker of normalizeCalibrationMarkers(markers)) {
      this.calibrationMarkerGroup.add(this.createCalibrationMarker(marker));
    }
    this.render();
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.orbitBatch?.setViewport(clientHeight, this.renderer.getPixelRatio());
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  capturePng() {
    this.render();
    if (this.palette.clearAlpha >= 1) return this.renderer.domElement.toDataURL('image/png');
    // A transparent stage would export as a transparent PNG: flatten it onto the stage colour.
    const source = this.renderer.domElement;
    const flat = document.createElement('canvas');
    flat.width = source.width;
    flat.height = source.height;
    const ctx = flat.getContext('2d');
    ctx.fillStyle = `#${new THREE.Color(this.palette.clear).getHexString()}`;
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(source, 0, 0);
    return flat.toDataURL('image/png');
  }

  getPerformanceStats() {
    if (this.orbitBatch) return { ...this.orbitBatch.stats(), totalDrawCalls: this.renderer?.info?.render?.calls ?? null };
    return {
      mode: 'individual', orbitCount: this.orbitGroups.size,
      orbitDrawCallBudget: [...this.orbitGroups.values()].reduce((sum, group) => sum + (group.root.visible ? [group.reference, group.tail, group.marker].filter((object) => object.visible).length : 0), 0),
      totalDrawCalls: this.renderer?.info?.render?.calls ?? null,
    };
  }
}

export { KM_TO_SCENE, vectorToScene };
