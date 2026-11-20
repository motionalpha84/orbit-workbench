// Central bodies for the MODEL menu. `available` marks the bodies the backend computes today;
// the others wait for the centerBody contract (docs/import-integration.md §4.1). J2 / J3 are
// offered for Earth only.
export const BODIES = [
  { id: 'earth', name: '地球', code: 'EARTH', radiusKm: 6378.137, models: ['two-body', 'j2', 'j3'], available: true },
  { id: 'moon', name: '月球', code: 'MOON', radiusKm: 1737.4, models: ['two-body'], available: false },
  { id: 'mars', name: '火星', code: 'MARS', radiusKm: 3396.19, models: ['two-body'], available: false },
  { id: 'sun', name: '太阳', code: 'SUN', radiusKm: 695700, models: ['two-body'], available: false },
];

export function bodyById(id) {
  return BODIES.find((body) => body.id === id) ?? BODIES[0];
}

export function modelsForBody(id) {
  return bodyById(id).models;
}

/** The model to keep after switching body: unchanged when the body offers it, else two-body. */
export function modelForBody(id, model) {
  return modelsForBody(id).includes(model) ? model : 'two-body';
}
