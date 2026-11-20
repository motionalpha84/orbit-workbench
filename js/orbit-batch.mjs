import * as THREE from '../vendor/three.module.js';

// This renderer accepts authoritative server samples only. Float32 is used at
// the GPU boundary; the source state and telemetry retain their precision.
export const ORBIT_BATCH_THRESHOLD = 128;
const KM_TO_SCENE = 1 / 6378.137;
const DEFAULT_CELL_SIZE = 0.24;
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const nextCapacity = (count) => Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, count))));

function putPosition(array, index, point) {
  array[index * 3] = point.x * KM_TO_SCENE;
  array[index * 3 + 1] = point.z * KM_TO_SCENE;
  array[index * 3 + 2] = -point.y * KM_TO_SCENE;
}

// A linked sparse grid avoids allocating one JS object per orbital sample.
// Static reference indices are reused until the backend replaces the samples.
export class PointSpatialIndex {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.next = new Int32Array(0);
    this.bounds = new THREE.Box3();
    this.point = new THREE.Vector3();
    this.lastQueryPointTests = 0;
  }

  rebuild(positions, count, alpha = null) {
    this.positions = positions;
    this.count = count;
    if (this.next.length < count) this.next = new Int32Array(nextCapacity(count));
    this.cells.clear();
    this.bounds.makeEmpty();
    const size = this.cellSize;
    for (let index = 0; index < count; index += 1) {
      if (alpha && alpha[index] <= 0) continue;
      const x = positions[index * 3];
      const y = positions[index * 3 + 1];
      const z = positions[index * 3 + 2];
      const key = `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
      this.next[index] = this.cells.get(key) ?? -1;
      this.cells.set(key, index);
      this.bounds.expandByPoint(this.point.set(x, y, z));
    }
  }

  pick(ray, threshold, accept = () => true) {
    this.lastQueryPointTests = 0;
    if (!this.cells.size) return null;
    const bounds = this.bounds.clone().expandByScalar(threshold);
    let near = 0;
    let far = Infinity;
    for (const axis of ['x', 'y', 'z']) {
      const direction = ray.direction[axis];
      if (Math.abs(direction) < 1e-12) {
        if (ray.origin[axis] < bounds.min[axis] || ray.origin[axis] > bounds.max[axis]) return null;
        continue;
      }
      let first = (bounds.min[axis] - ray.origin[axis]) / direction;
      let last = (bounds.max[axis] - ray.origin[axis]) / direction;
      if (first > last) [first, last] = [last, first];
      near = Math.max(near, first);
      far = Math.min(far, last);
    }
    if (far < near || !Number.isFinite(far)) return null;
    const size = this.cellSize;
    const start = ray.at(near + 1e-8, new THREE.Vector3());
    const cell = [Math.floor(start.x / size), Math.floor(start.y / size), Math.floor(start.z / size)];
    const steps = [];
    const nextBoundary = [];
    const stepDistance = [];
    for (const [index, axis] of ['x', 'y', 'z'].entries()) {
      const direction = ray.direction[axis];
      steps[index] = direction >= 0 ? 1 : -1;
      nextBoundary[index] = Math.abs(direction) < 1e-12 ? Infinity : (((cell[index] + (direction >= 0 ? 1 : 0)) * size - ray.origin[axis]) / direction);
      stepDistance[index] = Math.abs(direction) < 1e-12 ? Infinity : size / Math.abs(direction);
    }
    const margin = Math.max(1, Math.ceil(threshold / size));
    const visited = new Set();
    const thresholdSq = threshold * threshold;
    let best = null;
    const visitCell = (key) => {
      if (visited.has(key)) return;
      visited.add(key);
      for (let index = this.cells.get(key) ?? -1; index >= 0; index = this.next[index]) {
        if (!accept(index)) continue;
        this.lastQueryPointTests += 1;
        const dx = this.positions[index * 3] - ray.origin.x;
        const dy = this.positions[index * 3 + 1] - ray.origin.y;
        const dz = this.positions[index * 3 + 2] - ray.origin.z;
        const distance = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
        if (distance < 0 || (best && distance >= best.distance)) continue;
        const perpendicularSq = Math.max(0, dx * dx + dy * dy + dz * dz - distance * distance);
        if (perpendicularSq <= thresholdSq) best = { index, distance, distanceToRay: Math.sqrt(perpendicularSq) };
      }
    };
    let currentDistance = near;
    let traversed = 0;
    while (currentDistance <= far && (!best || currentDistance <= best.distance + threshold)) {
      for (let x = -margin; x <= margin; x += 1) for (let y = -margin; y <= margin; y += 1) for (let z = -margin; z <= margin; z += 1) {
        visitCell(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`);
      }
      let axis = nextBoundary[1] < nextBoundary[0] ? 1 : 0;
      if (nextBoundary[2] < nextBoundary[axis]) axis = 2;
      currentDistance = nextBoundary[axis];
      cell[axis] += steps[axis];
      nextBoundary[axis] += stepDistance[axis];
      traversed += 1;
      // Extreme-distance imported data must not cause an unbounded grid walk.
      // Fall back to exact point testing, preserving picking correctness.
      if (traversed > 4096) {
        for (const key of this.cells.keys()) visitCell(key);
        break;
      }
    }
    return best;
  }

  dispose() {
    this.cells.clear();
    this.positions = null;
    this.next = new Int32Array(0);
  }
}

function makeMaterial(kind, styleTexture, textureWidth, additive = true) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: kind === 'marker',
    // Additive glow reads on a dark sky; a light stage needs normal blending to stay visible.
    blending: kind === 'marker' || !additive ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: {
      styles: { value: styleTexture },
      styleWidth: { value: textureWidth },
      viewportHeight: { value: 800 },
      pixelRatio: { value: 1 },
      time: { value: 0 },
    },
    vertexShader: `
      attribute float orbitSlot;
      attribute float alpha;
      attribute float phase;
      uniform sampler2D styles;
      uniform float styleWidth;
      uniform float viewportHeight;
      uniform float pixelRatio;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vPhase;
      void main() {
        vec4 style = texture2D(styles, vec2((orbitSlot + 0.5) / styleWidth, 0.5));
        float selected = step(1.5, style.a) * (1.0 - step(2.5, style.a));
        float muted = step(2.5, style.a);
        float visible = step(0.5, style.a);
        vColor = style.rgb;
        vPhase = phase;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        ${kind === 'reference' ? `
          vAlpha = alpha * visible * mix(mix(0.28, 0.5, selected), 0.09, muted);
          gl_PointSize = 0.018 * viewportHeight * 0.5 / max(0.01, -mv.z);
        ` : kind === 'tail' ? `
          vAlpha = alpha * visible * mix(mix(1.0, 1.25, selected), 0.32, muted);
          gl_PointSize = 26.0 * pixelRatio * (0.52 + phase * 0.68) / max(0.4, -mv.z);
        ` : `
          vAlpha = alpha * visible * mix(1.0, 0.5, muted);
          float scale = mix(mix(1.0, 1.24, selected), 0.78, muted);
          gl_PointSize = 0.048 * scale * viewportHeight * 0.5 * projectionMatrix[1][1] / max(0.01, -mv.z);
        `}
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vPhase;
      void main() {
        if (vAlpha < 0.001) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        float radius = length(uv);
        ${kind === 'reference' ? 'gl_FragColor = vec4(vColor, vAlpha);' : kind === 'tail' ? `
          float falloff = 1.0 - smoothstep(0.0, 0.5, radius);
          float core = 1.0 - smoothstep(0.0, 0.32, radius);
          float pulse = 0.86 + 0.14 * sin(time * 4.0 + vPhase * 13.0);
          vec3 highlight = mix(vColor, vec3(1.0), 0.42);
          vec3 mixedColor = mix(vColor, highlight, smoothstep(0.18, 1.0, vPhase) * (0.55 + core * 0.45));
          gl_FragColor = vec4(mixedColor, vAlpha * falloff * pulse);
        ` : `
          if (radius > 0.5) discard;
          float sphere = sqrt(max(0.0, 1.0 - 4.0 * dot(uv, uv)));
          vec3 lit = vColor * (0.78 + sphere * 0.50) + vec3(pow(sphere, 14.0) * 0.2);
          gl_FragColor = vec4(lit, vAlpha * (1.0 - smoothstep(0.40, 0.5, radius)));
        `}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function makeGeometry(capacity, dynamic = false) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['orbitSlot', 1], ['alpha', 1], ['phase', 1]]) {
    const attribute = new THREE.BufferAttribute(new Float32Array(capacity * size), size);
    if (dynamic) attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.setDrawRange(0, 0);
  return geometry;
}

export class OrbitBatchRenderer {
  constructor({ additive = true, displayColor = (hex) => hex } = {}) {
    this.displayColor = displayColor;
    this.root = new THREE.Group();
    this.root.name = 'batched-orbits';
    this.records = [];
    this.recordById = new Map();
    this.selectedIds = new Set();
    this.styleTexture = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.styleTexture.needsUpdate = true;
    this.parts = {};
    for (const kind of ['reference', 'tail', 'marker']) {
      const object = new THREE.Points(makeGeometry(1, kind !== 'reference'), makeMaterial(kind, this.styleTexture, 1, additive));
      object.name = `orbit-batch-${kind}`;
      object.frustumCulled = false;
      this.parts[kind] = { object, index: new PointSpatialIndex(), indexDirty: false, count: 0, capacity: 1 };
      this.root.add(object);
    }
    this.lastFrameSeconds = 0;
    this.geometryRevision = 0;
    this.frameRevision = 0;
  }

  ensureCapacity(part, needed, dynamic) {
    if (part.capacity >= needed) return;
    part.capacity = nextCapacity(needed);
    part.object.geometry.dispose();
    part.object.geometry = makeGeometry(part.capacity, dynamic);
  }

  setRecords(records, selectedIds = this.selectedIds, showReference = true) {
    const referencesChanged = records.length !== this.records.length || records.some((record, index) => {
      const previous = this.records[index];
      return previous?.id !== record.id || this.referenceSources?.[index] !== record.reference;
    });
    this.records = [...records];
    this.recordById = new Map(records.map((record, index) => [record.id, { record, index }]));
    const width = nextCapacity(records.length);
    if (this.styleTexture.image.width !== width) {
      this.styleTexture.dispose();
      this.styleTexture = new THREE.DataTexture(new Float32Array(width * 4), width, 1, THREE.RGBAFormat, THREE.FloatType);
      for (const part of Object.values(this.parts)) {
        part.object.material.uniforms.styles.value = this.styleTexture;
        part.object.material.uniforms.styleWidth.value = width;
      }
    }
    this.setFocus(selectedIds);
    this.parts.reference.object.visible = showReference;
    if (referencesChanged) {
      this.referenceSources = records.map((record) => record.reference);
      this.rebuildReferences();
    }
  }

  setFocus(selectedIds = new Set()) {
    this.selectedIds = new Set(selectedIds);
    const activeSelection = [...this.selectedIds].some((id) => this.recordById.has(id));
    const array = this.styleTexture.image.data;
    array.fill(0);
    const color = new THREE.Color();
    this.records.forEach((record, index) => {
      color.set(this.displayColor(record.color || '#8bbfba'));
      const state = record.visible === false ? 0 : activeSelection ? this.selectedIds.has(record.id) ? 2 : 3 : 1;
      array.set([color.r, color.g, color.b, state], index * 4);
    });
    this.styleTexture.needsUpdate = true;
  }

  rebuildReferences() {
    const part = this.parts.reference;
    let needed = 0;
    for (const record of this.records) for (const sample of record.reference || []) if (finite(sample?.positionKm)) needed += 1;
    this.ensureCapacity(part, needed, false);
    const attributes = part.object.geometry.attributes;
    let cursor = 0;
    this.records.forEach((record, slot) => {
      for (const sample of record.reference || []) {
        if (!finite(sample?.positionKm)) continue;
        putPosition(attributes.position.array, cursor, sample.positionKm);
        attributes.orbitSlot.array[cursor] = slot;
        attributes.alpha.array[cursor] = 1;
        cursor += 1;
      }
    });
    this.finishPart(part, cursor);
    this.geometryRevision += 1;
  }

  updateFrame(computedRecords, elapsedSeconds = 0) {
    const marker = this.parts.marker;
    const tail = this.parts.tail;
    this.ensureCapacity(marker, this.records.length, true);
    let tailCount = 0;
    for (const record of this.records) {
      for (const point of computedRecords.get(record.id)?.trail || []) if (finite(point)) tailCount += 1;
    }
    this.ensureCapacity(tail, tailCount, true);
    const markers = marker.object.geometry.attributes;
    const tails = tail.object.geometry.attributes;
    let cursor = 0;
    this.records.forEach((record, slot) => {
      const computed = computedRecords.get(record.id);
      const current = computed?.state?.positionKm;
      markers.orbitSlot.array[slot] = slot;
      markers.alpha.array[slot] = finite(current) ? 1 : 0;
      if (finite(current)) putPosition(markers.position.array, slot, current);
      const trail = computed?.trail || [];
      let validCount = 0;
      for (const point of trail) if (finite(point)) validCount += 1;
      let index = 0;
      for (const point of trail) {
        if (!finite(point)) continue;
        const phase = validCount > 1 ? index / (validCount - 1) : 1;
        putPosition(tails.position.array, cursor, point);
        tails.orbitSlot.array[cursor] = slot;
        tails.alpha.array[cursor] = 0.03 + phase ** 1.35 * 0.84;
        tails.phase.array[cursor] = phase;
        index += 1;
        cursor += 1;
      }
    });
    this.finishPart(marker, this.records.length);
    this.finishPart(tail, cursor);
    this.lastFrameSeconds = elapsedSeconds;
    this.setTime(elapsedSeconds);
    this.frameRevision += 1;
  }

  finishPart(part, count) {
    part.count = count;
    const geometry = part.object.geometry;
    geometry.setDrawRange(0, count);
    for (const attribute of Object.values(geometry.attributes)) {
      attribute.clearUpdateRanges();
      if (count > 0) attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    // Picking is uncommon compared with frame delivery. Rebuild its CPU index
    // lazily on pointer interaction, never as part of the animation hot path.
    part.indexDirty = true;
  }

  setTime(seconds) {
    this.parts.tail.object.material.uniforms.time.value = seconds;
  }

  setViewport(height, pixelRatio = 1) {
    for (const part of Object.values(this.parts)) {
      part.object.material.uniforms.viewportHeight.value = height * pixelRatio;
      part.object.material.uniforms.pixelRatio.value = pixelRatio;
    }
  }

  pick(ray, threshold = 0.08) {
    this.root.updateWorldMatrix(true, false);
    const localRay = ray.clone().applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert());
    let best = null;
    for (const [kind, part] of Object.entries(this.parts)) {
      if (!part.object.visible) continue;
      if (part.indexDirty) {
        const attributes = part.object.geometry.attributes;
        part.index.rebuild(attributes.position.array, part.count, attributes.alpha.array);
        part.indexDirty = false;
      }
      const slots = part.object.geometry.attributes.orbitSlot.array;
      const hit = part.index.pick(localRay, kind === 'marker' ? Math.min(threshold, 0.035) : threshold, (index) => {
        return this.styleTexture.image.data[slots[index] * 4 + 3] > 0;
      });
      if (hit && (!best || hit.distance < best.distance)) best = { ...hit, id: this.records[slots[hit.index]]?.id, kind };
    }
    return best;
  }

  stats() {
    return {
      mode: 'batch',
      orbitCount: this.records.length,
      orbitDrawCallBudget: Object.values(this.parts).filter((part) => part.object.visible && part.count > 0).length,
      referencePoints: this.parts.reference.count,
      trailPoints: this.parts.tail.count,
      markerSlots: this.parts.marker.count,
      geometryRevision: this.geometryRevision,
      frameRevision: this.frameRevision,
      lastPickPointTests: Object.values(this.parts).reduce((total, part) => total + part.index.lastQueryPointTests, 0),
      allocatedAttributeBytes: Object.values(this.parts).reduce((sum, part) => sum + Object.values(part.object.geometry.attributes).reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0), 0),
    };
  }

  dispose() {
    for (const part of Object.values(this.parts)) {
      part.object.geometry.dispose();
      part.object.material.dispose();
      part.index.dispose();
    }
    this.styleTexture.dispose();
    this.root.clear();
    this.records = [];
    this.recordById.clear();
  }
}
