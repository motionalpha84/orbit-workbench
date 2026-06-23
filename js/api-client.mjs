const DEFAULT_API_BASE_URL = 'http://127.0.0.1:26563';

function configuredBaseUrl() {
  const runtimeValue = typeof globalThis.window === 'object'
    ? globalThis.window.__ORBIT_API_BASE_URL__
    : undefined;
  return typeof runtimeValue === 'string' && runtimeValue.trim()
    ? runtimeValue.trim().replace(/\/$/, '')
    : DEFAULT_API_BASE_URL;
}

export class BackendApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, details = {} } = {}) {
    super(message);
    this.name = 'BackendApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createBackendClient({ baseUrl = configuredBaseUrl(), fetchImpl = fetch } = {}) {
  const controllers = new Map();

  async function requestJson(key, path, body) {
    controllers.get(key)?.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      const error = payload.error ?? {};
      throw new BackendApiError(error.message || `API request failed: ${path}`, {
        code: error.code,
        status: response.status,
        details: error.details,
      });
    }
    return payload.data;
  }

  async function requestText(key, path, body) {
    controllers.get(key)?.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BackendApiError(text || `API request failed: ${path}`, {
        status: response.status,
      });
    }
    return text;
  }

  return {
    baseUrl,
    createOrbit(payload) {
      return requestJson('orbit', '/api/orbit', payload);
    },
    sceneRenderData(payload) {
      return requestJson('scene-render-data', '/api/scene-render-data', payload);
    },
    groundTrackRenderData(payload) {
      return requestJson('ground-track-render-data', '/api/ground-track-render-data', payload);
    },
    groundTrackRegionStats(payload) {
      return requestJson('ground-track-region-stats', '/api/ground-track-region-stats', payload);
    },
    groundTrackCsv(payload) {
      return requestText('ground-track-csv', '/api/ground-track-csv', payload);
    },
  };
}
