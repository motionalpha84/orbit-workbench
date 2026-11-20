import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';

// Presentation only: all orbital samples and live states come from the server.
const EARTH_RADIUS_KM = 6378.137;
const PALETTES = {
  command: { orbit: ['#8ce2d0', '#ecebdc', '#d8ba79', '#8da9c4'], grid: '#6eacaa', atmosphere: '#78ddcf', stars: '#bccfda' },
  ivory: { orbit: ['#5ad3bd', '#fff4d6', '#e6bc71', '#b6c5d9'], grid: '#7aa9a8', atmosphere: '#a5ecdc', stars: '#cad2d7' },
  matrix: { orbit: ['#9cdbb7', '#f0edd4', '#d4bc78', '#78b8b2'], grid: '#91a99a', atmosphere: '#9ad6bd', stars: '#ced4c1' },
};

function finiteVector(value) {
  return value && [value.x, value.y, value.z].every((part) => Number.isFinite(Number(part)));
}

function toScene(value, target = new THREE.Vector3()) {
  return target.set(Number(value.x) / EARTH_RADIUS_KM, Number(value.z) / EARTH_RADIUS_KM, -Number(value.y) / EARTH_RADIUS_KM);
}

function line(points, color, opacity = 1) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
}

function disposeTree(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose();
  });
}

function createGrid() {
  const group = new THREE.Group();
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const angle = THREE.MathUtils.degToRad(latitude);
    const points = Array.from({ length: 161 }, (_, index) => {
      const phase = index / 160 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(phase) * Math.cos(angle) * 1.006, Math.sin(angle) * 1.006, Math.sin(phase) * Math.cos(angle) * 1.006);
    });
    const ring = line(points, '#8ce2d0', latitude === 0 ? 0.27 : 0.12);
    ring.userData.equator = latitude === 0;
    group.add(ring);
  }
  for (let longitude = 0; longitude < 180; longitude += 30) {
    const angle = THREE.MathUtils.degToRad(longitude);
    const points = Array.from({ length: 161 }, (_, index) => {
      const phase = index / 160 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(phase) * Math.cos(angle) * 1.006, Math.sin(phase) * 1.006, Math.cos(phase) * Math.sin(angle) * 1.006);
    });
    group.add(line(points, '#8ce2d0', 0.075));
  }
  return group;
}

function createStars() {
  const positions = new Float32Array(580 * 3);
  let seed = 4173;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 580; i += 1) {
    const azimuth = random() * Math.PI * 2;
    const height = random() * 2 - 1;
    const radius = 70 + random() * 45;
    const circle = Math.sqrt(1 - height * height);
    positions.set([Math.cos(azimuth) * circle * radius, height * radius, Math.sin(azimuth) * circle * radius], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#bccfda', size: 0.075, transparent: true, opacity: 0.48, depthWrite: false, sizeAttenuation: true }));
}

export class PreviewScene {
  constructor(container) {
    if (!container) throw new Error('三维场景缺少容器。');
    this.container = container;
    this.disposed = false;
    this.theme = 'command';
    this.records = new Map();
    this.selectedId = null;
    this.layers = { grid: true, labels: true };
    this.maxRadius = 1.9;
    this.frameRequested = 0;
    this.textures = [];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.03, 300);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.domElement.setAttribute('aria-label', '地球与轨道三维视口。拖动旋转，滚轮缩放。');
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', position: 'absolute', inset: '0', touchAction: 'none' });
    container.append(this.renderer.domElement);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'scene-label-layer';
    Object.assign(this.labelLayer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
    container.append(this.labelLayer);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 38;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('change', () => this.requestRender());
    this.pointerStart = null;
    this.onPointerDown = (event) => { this.pointerStart = { x: event.clientX, y: event.clientY }; };
    this.onPointerUp = (event) => {
      if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 4) return;
      const bounds = this.renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, this.camera);
      const markers = [...this.records.values()].filter((record) => record.root.visible && record.marker.visible).map((record) => record.marker);
      const hit = raycaster.intersectObjects([this.earth, ...markers], false)[0];
      if (hit?.object.userData.orbitId) {
        const id = hit.object.userData.orbitId;
        this.setSelected(id);
        this.container.dispatchEvent(new CustomEvent('orbitselect', { detail: { id }, bubbles: true }));
      }
    };
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.scene.add(new THREE.AmbientLight(0xabc6cd, 0.82));
    const sun = new THREE.DirectionalLight(0xf6f4e7, 2.25);
    sun.position.set(-4, 3, 5);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x63cabc, 0.75);
    rim.position.set(3, -1, -3);
    this.scene.add(rim);
    this.earthRoot = new THREE.Group();
    this.scene.add(this.earthRoot);
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshPhongMaterial({ color: 0x65777d, shininess: 12, specular: 0x284440 }));
    this.earth.rotation.y = -0.5;
    this.earth.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float grayEarth = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(grayEarth), diffuseColor.rgb, 0.13) * vec3(0.78, 0.94, 1.0);`);
    };
    this.earthRoot.add(this.earth);
    const texture = new THREE.TextureLoader().load(new URL('../assets/textures/earth_blue_marble_topo_5400.jpg', import.meta.url).href, (loaded) => {
      if (this.disposed) { loaded.dispose(); return; }
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.earth.material.map = loaded;
      this.earth.material.color.set(0xb7c6ca);
      this.earth.material.needsUpdate = true;
      this.requestRender();
    }, undefined, () => this.requestRender());
    this.textures.push(texture);
    this.grid = createGrid();
    this.earthRoot.add(this.grid);
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 48), new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color('#78ddcf') } },
      vertexShader: `varying vec3 vNormal; varying vec3 vPosition; void main() { vec4 world = modelMatrix * vec4(position, 1.0); vPosition = world.xyz; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * world; }`,
      fragmentShader: `uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vPosition; void main() { vec3 viewDir = normalize(cameraPosition - vPosition); float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 4.5); gl_FragColor = vec4(glowColor, fresnel * 0.24); }`,
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.atmosphere);
    this.stars = createStars();
    this.scene.add(this.stars);
    this.orbitRoot = new THREE.Group();
    this.scene.add(this.orbitRoot);
    this.axisGroup = new THREE.Group();
    [[new THREE.Vector3(1, 0, 0), '#bd827d'], [new THREE.Vector3(0, 0, -1), '#8bbd9e'], [new THREE.Vector3(0, 1, 0), '#82a7cb']].forEach(([direction, color]) => {
      this.axisGroup.add(line([direction.clone().multiplyScalar(1.025), direction.clone().multiplyScalar(1.42)], color, 0.45));
    });
    this.scene.add(this.axisGroup);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView('reset');
  }

  resize() {
    if (this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.requestRender();
  }

  setRecords(preparedRecords = [], rawRecords = []) {
    const prepared = Array.isArray(preparedRecords) ? preparedRecords : preparedRecords.records || [];
    const raw = new Map((Array.isArray(rawRecords) ? rawRecords : []).map((record) => [String(record.id), record]));
    const hadRecords = this.records.size > 0;
    const previousRadius = this.maxRadius;
    for (const record of this.records.values()) { disposeTree(record.root); record.label.remove(); }
    this.orbitRoot.clear();
    this.records.clear();
    this.maxRadius = 1.5;
    prepared.forEach((record, index) => {
      const id = String(record.id);
      const source = raw.get(id) || record;
      const samples = (record.reference || []).filter((sample) => finiteVector(sample.positionKm));
      const points = samples.map((sample) => toScene(sample.positionKm));
      for (const point of points) this.maxRadius = Math.max(this.maxRadius, point.length());
      const root = new THREE.Group();
      root.visible = source.visible !== false;
      const color = source.color || PALETTES[this.theme].orbit[index % 4];
      const reference = line(points, color, 0.56);
      root.add(reference);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.027, 0), new THREE.MeshBasicMaterial({ color }));
      marker.userData.orbitId = id;
      marker.rotation.z = Math.PI / 4;
      const position = record.initialState?.positionKm || record.state?.positionKm || samples[0]?.positionKm;
      marker.visible = Boolean(finiteVector(position));
      if (marker.visible) toScene(position, marker.position);
      root.add(marker);
      const label = document.createElement('button');
      label.type = 'button';
      label.textContent = source.name || record.name || `ORBIT-${String(index + 1).padStart(2, '0')}`;
      label.title = '选择此轨道';
      Object.assign(label.style, {
        position: 'absolute', left: '0', top: '0', border: '0', borderLeft: `2px solid ${color}`,
        color, background: 'rgba(10, 15, 17, .82)', padding: '5px 9px', font: '10px Consolas, monospace',
        letterSpacing: '1.2px', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer',
      });
      label.addEventListener('click', () => {
        this.setSelected(id);
        this.container.dispatchEvent(new CustomEvent('orbitselect', { detail: { id }, bubbles: true }));
      });
      this.labelLayer.append(label);
      this.orbitRoot.add(root);
      this.records.set(id, { root, reference, marker, label, index, customColor: Boolean(source.color), color });
    });
    if (!hadRecords || this.maxRadius > previousRadius * 1.25) this.setView('reset');
    this.setSelected(this.selectedId);
    this.requestRender();
  }

  updateFrame(frame) {
    if (this.disposed) return;
    for (const record of this.records.values()) record.marker.visible = false;
    for (const computed of frame?.records || []) {
      const record = this.records.get(String(computed.id));
      if (!record) continue;
      const position = computed.state?.positionKm;
      record.marker.visible = Boolean(finiteVector(position));
      if (record.marker.visible) toScene(position, record.marker.position);
    }
    this.requestRender();
  }

  setView(view) {
    const aspect = Math.min(1, this.camera.aspect);
    const visibleRadius = Math.min(Math.max(this.maxRadius, 1.6), 25);
    const distance = Math.max(4.5, visibleRadius / Math.sin(THREE.MathUtils.degToRad(19)) / aspect * 1.08);
    this.controls.maxDistance = Math.max(38, distance * 2);
    this.camera.up.set(0, 1, 0);
    if (view === 'top') this.camera.position.set(0, distance, 0.001);
    else if (view === 'front') this.camera.position.set(0, 0.18, distance);
    else this.camera.position.copy(new THREE.Vector3(0.42, 0.35, 1).normalize().multiplyScalar(distance));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.requestRender();
  }

  setTheme(theme) {
    this.theme = PALETTES[theme] ? theme : 'command';
    const palette = PALETTES[this.theme];
    this.grid.children.forEach((ring) => ring.material.color.set(ring.userData.equator ? '#d1ddd5' : palette.grid));
    this.stars.material.color.set(palette.stars);
    this.atmosphere.material.uniforms.glowColor.value.set(palette.atmosphere);
    for (const record of this.records.values()) {
      if (record.customColor) continue;
      record.color = palette.orbit[record.index % 4];
      record.reference.material.color.set(record.color);
      record.marker.material.color.set(record.color);
      record.label.style.color = record.color;
      record.label.style.borderLeftColor = record.color;
    }
    this.requestRender();
  }

  setSelected(id) {
    this.selectedId = id == null ? null : String(id);
    for (const [key, record] of this.records) {
      const selected = key === this.selectedId;
      record.reference.material.opacity = selected ? 0.95 : this.selectedId ? 0.26 : 0.56;
      record.marker.scale.setScalar(selected ? 1.45 : 1);
      record.label.style.opacity = selected || !this.selectedId ? '1' : '.65';
      record.label.style.background = selected ? 'rgba(21, 38, 38, .94)' : 'rgba(10, 15, 17, .82)';
    }
    this.requestRender();
  }

  setLayers(layers = {}) {
    Object.assign(this.layers, layers);
    this.grid.visible = this.layers.grid !== false;
    this.axisGroup.visible = this.layers.grid !== false;
    this.requestRender();
  }

  requestRender() {
    if (this.disposed || this.frameRequested) return;
    this.frameRequested = requestAnimationFrame(() => {
      this.frameRequested = 0;
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    });
  }

  updateLabels() {
    const cameraPosition = this.camera.position;
    for (const record of this.records.values()) {
      const point = record.marker.position;
      const projection = point.clone().project(this.camera);
      const direction = point.clone().sub(cameraPosition);
      const length = direction.length();
      direction.normalize();
      const nearest = Math.max(0, Math.min(length, -cameraPosition.dot(direction)));
      const blocked = cameraPosition.clone().addScaledVector(direction, nearest).lengthSq() < 0.985;
      const visible = record.root.visible && record.marker.visible && this.layers.labels && !blocked && projection.z < 1 && projection.z > -1;
      record.label.style.display = visible ? 'block' : 'none';
      if (visible) record.label.style.transform = `translate(${(projection.x * .5 + .5) * this.width + 12}px, ${(-projection.y * .5 + .5) * this.height - 12}px)`;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameRequested);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    disposeTree(this.scene);
    this.textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
    this.records.clear();
  }
}
