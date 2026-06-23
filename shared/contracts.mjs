export const API_VERSION = 1;

export const SUPPORTED_PERTURBATION_MODELS = Object.freeze(['two-body', 'j2', 'j3']);
export const SUPPORTED_PERFORMANCE_MODES = Object.freeze(['power-save', 'balanced', 'high', 'custom']);
export const SUPPORTED_FRAMES = Object.freeze(['ECI', 'ECEF']);
export const SUPPORTED_TIME_UNITS = Object.freeze(['s', 'min', 'hr', 'day']);

export const DEFAULT_PERFORMANCE_OPTIONS = Object.freeze({
  mode: 'balanced',
  memoryGb: 4,
});

export const DEFAULT_GROUND_TRACK_WINDOW = Object.freeze({
  mode: 'revs',
  pastRevs: 2,
  pastSeconds: 3600,
  timeUnit: 'min',
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function recordValue(value) {
  return value !== null && typeof value === 'object' ? value : {};
}

function boundedMemoryGb(value) {
  const number = finiteNumber(value, DEFAULT_PERFORMANCE_OPTIONS.memoryGb);
  if (number < 0) {
    return DEFAULT_PERFORMANCE_OPTIONS.memoryGb;
  }
  return Math.max(1, Math.min(24, number));
}

function nonNegativeNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return number >= 0 ? number : fallback;
}

export function apiOk(data) {
  return { ok: true, data };
}

export function apiError(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
}

export function normalizePerturbationModelValue(value) {
  return SUPPORTED_PERTURBATION_MODELS.includes(value) ? value : 'two-body';
}

export function normalizeFrame(value) {
  return value === 'ECEF' ? 'ECEF' : 'ECI';
}

export function normalizePerformanceOptions(value = {}) {
  const options = recordValue(value);
  const mode = SUPPORTED_PERFORMANCE_MODES.includes(options.mode)
    ? options.mode
    : DEFAULT_PERFORMANCE_OPTIONS.mode;
  return {
    mode,
    memoryGb: boundedMemoryGb(options.memoryGb),
  };
}

export function normalizeGroundTrackWindow(value = {}) {
  const options = recordValue(value);
  const mode = options.mode === 'time' ? 'time' : 'revs';
  const timeUnit = SUPPORTED_TIME_UNITS.includes(options.timeUnit)
    ? options.timeUnit
    : DEFAULT_GROUND_TRACK_WINDOW.timeUnit;
  return {
    mode,
    pastRevs: Math.floor(nonNegativeNumber(options.pastRevs, DEFAULT_GROUND_TRACK_WINDOW.pastRevs)),
    pastSeconds: nonNegativeNumber(options.pastSeconds, DEFAULT_GROUND_TRACK_WINDOW.pastSeconds),
    timeUnit,
  };
}
