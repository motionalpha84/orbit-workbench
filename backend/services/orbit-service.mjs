import { normalizeHexColor } from '../../js/color.mjs';
import { computeOrbit, propagateOrbit } from '../../js/orbit.mjs';
import { ApiRequestError } from '../errors.mjs';

function orbitId(input = {}) {
  if (typeof input.id === 'string' && input.id.trim()) return input.id.trim();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `orbit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function orbitName(elements, fallbackIndex = 1) {
  const name = elements?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : `Orbit ${fallbackIndex}`;
}

export function createOrbitRecord(input = {}, options = {}) {
  try {
    const orbit = computeOrbit(input.elements ?? input);
    const initial = propagateOrbit(orbit, 0, { perturbationModel: 'two-body' });
    return {
      id: orbitId(input),
      name: orbitName(orbit.elements, options.index ?? 1),
      color: normalizeHexColor(input.color, '#568c87'),
      visible: input.visible ?? true,
      orbit,
      metrics: {
        periodSeconds: orbit.periodSeconds,
        periapsisAltitudeKm: orbit.periapsisAltitudeKm,
        apoapsisAltitudeKm: orbit.apoapsisAltitudeKm,
        speedRangeKmS: orbit.speedRangeKmS,
        initialPositionKm: initial.positionKm,
        initialVelocityKmS: initial.velocityKmS,
      },
    };
  } catch (error) {
    throw new ApiRequestError(400, 'VALIDATION_ERROR', error.message, {
      errors: error.errors ?? [error.message],
    });
  }
}
