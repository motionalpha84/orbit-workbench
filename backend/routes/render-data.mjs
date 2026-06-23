import { ok } from '../errors.mjs';
import { createSceneRenderData } from '../services/render-data-service.mjs';

export async function registerRenderDataRoutes(app) {
  app.post('/api/scene-render-data', async (request) => ok(createSceneRenderData(request.body ?? {})));
}
