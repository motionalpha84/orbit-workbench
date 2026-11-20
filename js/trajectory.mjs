// Imported position-vector trajectories: smoothing between samples and the ECI / ECEF views of
// the result. Pure functions; the schematic only projects what these return.
import { greenwichSiderealAngleAt } from './groundtrack.mjs';

const MAX_SEGMENT_STEPS = 32;
const STEP_ANGLE_RAD = 1.5 * Math.PI / 180;

const toArray = (v) => [Number(v.x), Number(v.y), Number(v.z)];
const rotZ = (p, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
};
const angleBetween = (a, b) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  return Math.atan2(cross, dot);
};

// cubic Hermite with velocity tangents scaled to the segment duration
function hermite(p0, v0, p1, v1, dt, u) {
  const u2 = u * u; const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1; const h10 = u3 - 2 * u2 + u; const h01 = -2 * u3 + 3 * u2; const h11 = u3 - u2;
  return [0, 1, 2].map((k) => h00 * p0[k] + h10 * dt * v0[k] + h01 * p1[k] + h11 * dt * v1[k]);
}

// centripetal Catmull-Rom (α = 0.5, Barry–Goldman): no cusps or self-loops on uneven spacing
function catmullRom(p0, p1, p2, p3, u) {
  const knot = (a, b) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) ** 0.5, 1e-9);
  const t1 = knot(p0, p1); const t2 = t1 + knot(p1, p2); const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => a.map((value, k) => ((tb - t) * value + (t - ta) * b[k]) / (tb - ta));
  const a1 = lerp(p0, p1, 0, t1); const a2 = lerp(p1, p2, t1, t2); const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, 0, t2); const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Densifies a trajectory into a smooth curve. Samples with velocities use cubic Hermite (the
 * curve matches both position and velocity at every sample); position-only samples use a
 * centripetal Catmull-Rom spline. Steps per segment follow the swept angle, so sparse samples
 * on a curved arc gain more points; the total stays within `maxPoints`.
 * Returns [{ t, p: [x, y, z] }] in km, `t` in seconds from the first sample.
 */
export function smoothTrajectory(samples, { maxPoints = 6000 } = {}) {
  const points = samples.map((sample) => toArray(sample.positionKm));
  const velocities = samples.every((sample) => sample.velocityKmS) ? samples.map((sample) => toArray(sample.velocityKmS)) : null;
  const n = points.length;
  if (n < 2) return points.map((p, index) => ({ t: samples[index].t, p }));
  const steps = [];
  for (let i = 0; i < n - 1; i += 1) steps.push(Math.min(MAX_SEGMENT_STEPS, Math.max(1, Math.ceil(angleBetween(points[i], points[i + 1]) / STEP_ANGLE_RAD))));
  const wanted = steps.reduce((sum, value) => sum + value, 0);
  const budget = Math.max(n - 1, maxPoints - 1);
  const scale = wanted > budget ? budget / wanted : 1;
  const dense = [];
  for (let i = 0; i < n - 1; i += 1) {
    const t0 = samples[i].t; const dt = samples[i + 1].t - t0;
    const count = Math.max(1, Math.floor(steps[i] * scale));
    // the ends extrapolate a phantom neighbour (quadratic through three samples when there are
    // three) so the first and last segments keep the arc's curvature instead of flattening
    const phantom = (a, b, c) => a.map((value, k) => (c ? 3 * value - 3 * b[k] + c[k] : 2 * value - b[k]));
    const before = i > 0 ? points[i - 1] : phantom(points[0], points[1], points[2]);
    const after = i + 2 < n ? points[i + 2] : phantom(points[n - 1], points[n - 2], points[n - 3]);
    for (let j = 0; j < count; j += 1) {
      const u = j / count;
      const p = j === 0 ? points[i]
        : velocities ? hermite(points[i], velocities[i], points[i + 1], velocities[i + 1], dt, u)
          : catmullRom(before, points[i], points[i + 1], after, u);
      dense.push({ t: t0 + dt * u, p });
    }
  }
  dense.push({ t: samples[n - 1].t, p: points[n - 1] });
  return dense;
}

/** Elapsed simulation seconds of a trajectory-relative time, for a given simulation start. */
export function trajectoryElapsed(timeOrigin, t, epochMs) {
  return timeOrigin?.kind === 'utc' ? (timeOrigin.utcMs - epochMs) / 1000 + t : (timeOrigin?.elapsedSeconds ?? 0) + t;
}

/**
 * The same curve in both display frames: ECEF = Rz(−θ(t)) · ECI at each sample's own time.
 * Returns { elapsed: Float64Array, eci: [[x,y,z]], ecef: [[x,y,z]] }.
 */
export function trajectoryFrames(trajectory, epochMs) {
  const dense = trajectory.dense;
  const elapsed = new Float64Array(dense.length);
  const eci = new Array(dense.length);
  const ecef = new Array(dense.length);
  dense.forEach(({ t, p }, index) => {
    const seconds = trajectoryElapsed(trajectory.timeOrigin, t, epochMs);
    const theta = greenwichSiderealAngleAt(epochMs, seconds);
    elapsed[index] = seconds;
    if (trajectory.frame === 'ECEF') { ecef[index] = p; eci[index] = rotZ(p, theta); } else { eci[index] = p; ecef[index] = rotZ(p, -theta); }
  });
  return { elapsed, eci, ecef };
}

/** Linear position along the dense curve at `seconds`, or null outside the covered span. */
export function trajectoryPositionAt(elapsed, points, seconds) {
  const n = elapsed.length;
  if (n === 0 || seconds < elapsed[0] || seconds > elapsed[n - 1]) return null;
  let lo = 0; let hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (elapsed[mid] <= seconds) lo = mid; else hi = mid; }
  const span = elapsed[hi] - elapsed[lo];
  const f = span > 0 ? (seconds - elapsed[lo]) / span : 0;
  return points[lo].map((value, k) => value + (points[hi][k] - value) * f);
}
