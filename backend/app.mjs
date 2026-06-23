import cors from '@fastify/cors';
import Fastify from 'fastify';

import { API_VERSION } from '../shared/contracts.mjs';
import { ApiRequestError, fail, methodNotAllowed, notFound } from './errors.mjs';

const POST_ONLY_PATHS = new Set([
  '/api/orbit',
  '/api/scene-render-data',
  '/api/ground-track-render-data',
  '/api/ground-track-region-stats',
  '/api/ground-track-csv',
]);

export function createBackendApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 8 * 1024 * 1024,
  });

  app.register(cors, {
    origin: true,
  });

  app.get('/', async () => ({
    ok: true,
    service: 'orbit-api',
    version: API_VERSION,
  }));

  for (const path of POST_ONLY_PATHS) {
    app.get(path, async (request) => {
      throw methodNotAllowed(path, request.method);
    });
  }

  app.setNotFoundHandler((request) => {
    throw notFound(new URL(request.url, 'http://127.0.0.1').pathname);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiRequestError) {
      reply.status(error.statusCode).send(fail(error.code, error.message, error.details));
      return;
    }
    if (error.validation) {
      reply.status(400).send(fail('VALIDATION_ERROR', 'Request validation failed.', { validation: error.validation }));
      return;
    }
    reply.status(500).send(fail('INTERNAL_ERROR', error?.message || 'Internal server error.'));
  });

  return app;
}
