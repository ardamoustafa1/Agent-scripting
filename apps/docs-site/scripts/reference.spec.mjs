import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDefaultRegistry, evaluate } from '@verbis/expr';
import { expressionExamples, connectorGuides } from './reference-data.mjs';
import { validateCapture } from './capture-policy.mjs';

const site = fileURLToPath(new URL('../', import.meta.url));
async function pages(dir, prefix = '') {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory())
      result.push(...(await pages(dir + '/' + item.name, prefix + item.name + '/')));
    else if (item.name.endsWith('.md')) result.push(prefix + item.name);
  }
  return result.sort();
}
test('TR and EN guides have identical routes and all requested connector guides', async () => {
  const tr = await pages(site + 'src/content/docs/tr');
  assert.deepEqual(tr, await pages(site + 'src/content/docs/en'));
  for (const [slug] of connectorGuides) assert.ok(tr.includes('connectors/' + slug + '.md'));
  for (const route of [
    'designer/first-script.md',
    'designer/components.md',
    'designer/functions.md',
    'developer/rest-api.md',
    'demo.md',
  ])
    assert.ok(tr.includes(route));
});
test('all expression functions have executable documented examples', () => {
  assert.deepEqual(
    Object.keys(expressionExamples).sort(),
    createDefaultRegistry()
      .list()
      .map((fn) => fn.name)
      .sort(),
  );
  for (const [name, [source, expected]] of Object.entries(expressionExamples)) {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          evaluate(
            source,
            {},
            { now: () => Date.parse('2026-10-03T09:00:00Z'), budgetClock: () => 0 },
          ),
        ),
      ),
      expected,
      name,
    );
  }
});
test('downloadable OpenAPI equals the committed contract', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  assert.deepEqual(
    JSON.parse(await readFile(site + 'public/api/openapi.json', 'utf8')),
    JSON.parse(await readFile(root + 'apps/api/openapi.json', 'utf8')),
  );
});
test('capture refuses credential leaks, foreign origins and repository auth states', () => {
  const step = {
    name: 'designer-first-tr',
    url: 'http://localhost:5173/',
    authState: 'designer.json',
    readySelector: 'main',
  };
  const check = (value, auth = '/private/demo-auth') =>
    validateCapture(
      { syntheticOnly: true, steps: [value] },
      ['http://localhost:5173'],
      auth,
      '/repo',
    );
  assert.equal(check(step).length, 1);
  for (const url of [
    'https://foreign.example/',
    'http://localhost:5173/?token=secret',
    'http://user:secret@localhost:5173/',
    'http://localhost:5173/#code',
  ])
    assert.throws(() => check({ ...step, url }));
  assert.throws(() => check({ ...step, authState: '../secret.json' }));
  assert.throws(() => check(step, '/repo/auth'));
  assert.throws(() =>
    validateCapture({ steps: [step] }, ['http://localhost:5173'], '/private/auth', '/repo'),
  );
});
