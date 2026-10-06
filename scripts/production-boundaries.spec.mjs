import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`])),
    )
  ).flat();
}
test('hub production artifacts contain no fake applications or test transports', async () => {
  const output = await files('apps/connector-hub/dist');
  assert.deepEqual(
    output.filter((path) => /\/test\/|\/[^/]+-test\./.test(path)),
    [],
  );
});
test('product templates import a dedicated module without broken or legacy fixtures', async () => {
  const api = await readFile('apps/api/src/modules/scripts/templates.service.ts', 'utf8');
  assert.match(api, /script-schema\/templates/);
  assert.doesNotMatch(api, /script-schema\/fixtures/);
  const output = await files('packages/script-schema/dist/templates');
  assert.equal(
    output.some((path) => /broken|legacy/.test(path)),
    false,
  );
});
