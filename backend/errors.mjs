import { apiError, apiOk } from '../shared/contracts.mjs';

export class ApiRequestError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function ok(data) {
  return apiOk(data);
}

export function fail(code, message, details = {}) {
  return apiError(code, message, details);
}

export function notFound(path) {
  return new ApiRequestError(404, 'NOT_FOUND', `API route not found: ${path}`, { path });
}

export function methodNotAllowed(path, method) {
  return new ApiRequestError(405, 'METHOD_NOT_ALLOWED', `${path} requires POST.`, { path, method });
}
