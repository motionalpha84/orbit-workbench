import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend API client defaults to backend port 26563 and exposes required methods', async () => {
  const client = await readFile('js/api-client.mjs', 'utf8');

  assert.match(client, /127\.0\.0\.1:26563/);
  assert.match(client, /window\.__ORBIT_API_BASE_URL__/);
  for (const method of [
    'createOrbit',
    'sceneRenderData',
    'groundTrackRenderData',
    'groundTrackRegionStats',
    'groundTrackCsv',
  ]) {
    assert.match(client, new RegExp(`${method}\\(`), `client should expose ${method}`);
  }
  assert.match(client, /AbortController/);
  assert.match(client, /response\.json/);
  assert.match(client, /response\.text/);
});
