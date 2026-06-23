import { ok } from '../errors.mjs';
import {
  createGroundTrackCsv,
  createGroundTrackRegionStats,
  createGroundTrackRenderData,
} from '../services/groundtrack-service.mjs';

export async function registerGroundTrackRoutes(app) {
  app.post('/api/ground-track-render-data', async (request) => ok(createGroundTrackRenderData(request.body ?? {})));
  app.post('/api/ground-track-region-stats', async (request) => ok(createGroundTrackRegionStats(request.body ?? {})));
  app.post('/api/ground-track-csv', async (request, reply) => {
    reply.type('text/csv; charset=utf-8').send(createGroundTrackCsv(request.body ?? {}));
  });
}
