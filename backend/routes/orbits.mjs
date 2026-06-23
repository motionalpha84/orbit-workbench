import { ok } from '../errors.mjs';
import { createOrbitRecord } from '../services/orbit-service.mjs';

export async function registerOrbitRoutes(app) {
  app.post('/api/orbit', async (request) => ok(createOrbitRecord(request.body ?? {})));
}
