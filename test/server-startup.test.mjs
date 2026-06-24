import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { startFrontendServer } from '../server.mjs';

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitForStdout(child, pattern) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${pattern}`));
    }, 3000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timeout);
        resolve(output);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Process exited before startup output with code ${code}`));
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
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

test('frontend server entrypoint starts a long-running process on Windows paths', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const output = await waitForStdout(child, /ECI orbit workbench frontend running at http:\/\/127\.0\.0\.1:\d+/);
    assert.match(output, /127\.0\.0\.1/);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
  }
});

test('package scripts expose frontend, backend, dev, and test commands', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.frontend, 'node server.mjs');
  assert.equal(pkg.scripts.backend, 'node backend/server.mjs');
  assert.match(pkg.scripts.dev, /concurrently/);
  assert.doesNotMatch(pkg.scripts.dev, /npm run/, 'dev should not require npm inside child processes');
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
  assert.match(script, /BUNDLED_NODE_DIR/, 'launcher should add bundled Node to PATH when node is unavailable');
  assert.match(script, /PROJECT_USERPROFILE/, 'launcher should find bundled runtimes even when started from another user profile');
  assert.match(script, /concurrently\.js/, 'launcher should run installed dependencies without npm or pnpm');
  assert.match(script, /npm run dev/);
  assert.match(script, /http:\/\/127\.0\.0\.1:4173/);
  assert.match(readme, /26563/);
  assert.match(readme, /npm run dev/);
});
