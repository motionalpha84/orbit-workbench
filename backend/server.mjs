import { createBackendApp } from './app.mjs';

const port = Number(process.env.API_PORT || 26563);
const host = process.env.API_HOST || '127.0.0.1';

const app = createBackendApp({ logger: true });

try {
  await app.listen({ port, host });
  console.log(`Orbit API running at http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
