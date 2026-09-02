import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('development API runs without a file watcher (no restart loops)', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.scripts['dev:api'], 'node --env-file-if-exists=.env server/index.mjs');
});
