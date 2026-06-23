import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { startFrontendServer } from '../server.mjs';

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('frontend server can start on an ephemeral port and serve index.html', async () => {
  const server = await startFrontendServer({ port: 0, host: '127.0.0.1', log: false });
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/index.html`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /轨道模拟工作台/);
  } finally {
    await closeServer(server);
  }
});

test('package scripts expose frontend, backend, dev, and test commands', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.frontend, 'node server.mjs');
  assert.equal(pkg.scripts.backend, 'node backend/server.mjs');
  assert.match(pkg.scripts.dev, /concurrently/);
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.dependencies.fastify.length > 0, true);
  assert.equal(pkg.dependencies['@fastify/cors'].length > 0, true);
  assert.equal(pkg.devDependencies.concurrently.length > 0, true);
});

test('Windows launcher starts the dual-process workbench', async () => {
  const script = await readFile('start-workbench.bat', 'utf8');
  const readme = await readFile('README.md', 'utf8');

  assert.match(script, /API_PORT=26563/);
  assert.match(script, /pnpm/, 'launcher should fall back to pnpm when npm is unavailable');
  assert.match(script, /npm run dev/);
  assert.match(script, /http:\/\/127\.0\.0\.1:4173/);
  assert.match(readme, /26563/);
  assert.match(readme, /npm run dev/);
});
