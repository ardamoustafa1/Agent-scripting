import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { unresolvedAdvisories } from './dependency-security.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const remediation = {
  package: 'extract-zip',
  version: '2.0.1',
  advisories: [1139346, 1193685],
  expires: '2026-11-03',
};
const advisory = {
  id: 1139346,
  module_name: 'extract-zip',
  severity: 'high',
  findings: [{ version: '2.0.1' }],
};
const report = (item) => ({ metadata: { vulnerabilities: {} }, advisories: { issue: item } });
test('only exact, unexpired, patched advisories are classified as locally remediated', () => {
  assert.deepEqual(unresolvedAdvisories(report(advisory), remediation, '2026-10-04'), []);
  for (const change of [
    { id: 999 },
    { module_name: 'other' },
    { severity: 'critical' },
    { findings: [{ version: '2.0.2' }] },
    { findings: [] },
  ])
    assert.equal(
      unresolvedAdvisories(report({ ...advisory, ...change }), remediation, '2026-10-04').length,
      1,
    );
  assert.equal(unresolvedAdvisories(report(advisory), remediation, '2026-11-04').length, 1);
  assert.throws(() => unresolvedAdvisories({ error: {} }, remediation));
});

test('Mammoth CLI retains help without loading the vulnerable sprintf formatter', () => {
  const api = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const cli = path.join(path.dirname(api.resolve('mammoth')), '..', 'bin', 'mammoth');
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `process.on('exit', () => {
        if (Object.keys(require.cache).some(p => p.includes('/sprintf-js/'))) process.exitCode = 1;
      });
      process.argv = [process.execPath, process.argv[1], '--help'];
      require(process.argv[1]);`,
      cli,
    ],
    { cwd: root, encoding: 'utf8', timeout: 15000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--output-format/);
  assert.match(result.stdout, /--style-map/);
});

test('Docs nested CSS handles a 400 KB flat selector within a bounded process', () => {
  let require = createRequire(
    realpathSync(path.join(root, 'apps/docs-site/node_modules/@astrojs/starlight/package.json')),
  );
  for (const dependency of [
    'astro-expressive-code',
    'rehype-expressive-code',
    'expressive-code',
    '@expressive-code/core',
    'postcss-nested',
  ])
    require = createRequire(require.resolve(dependency));
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const assert = require('node:assert/strict');
      const postcss = require(process.argv[1]);
      const nested = require(process.argv[2]);
      const selector = '.a'.repeat(200000);
      postcss([nested()]).process('.root { ' + selector + ' {color:red;} }', {from: undefined})
        .then(result => assert.equal(result.css, '.root ' + selector + ' {color:red;}'))
        .catch(error => { console.error(error.message); process.exitCode = 1; });`,
      require.resolve('postcss'),
      require.resolve('postcss-nested'),
    ],
    { cwd: root, encoding: 'utf8', timeout: 15000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
