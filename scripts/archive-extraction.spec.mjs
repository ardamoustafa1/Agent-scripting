import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../apps/agent-web/package.json', import.meta.url));
// Resolve through the real Lighthouse dependency, ensuring the installed patch is exercised.
const browserRequire = createRequire(
  require.resolve('puppeteer-core/package.json', {
    paths: [
      path.dirname(
        createRequire(require.resolve('@lhci/cli/package.json')).resolve('lighthouse/package.json'),
      ),
    ],
  }),
);
const extract = createRequire(browserRequire.resolve('@puppeteer/browsers'))('extract-zip');

async function archive(entries, run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'verbis-zip-test-'));
  try {
    const zip = path.join(directory, 'test.zip');
    const script =
      'import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for entry in json.loads(sys.argv[2]):\n  i=zipfile.ZipInfo(entry["name"]); i.create_system=3; i.external_attr=(0o120777 if entry.get("link") else 0o100644)<<16; z.writestr(i,entry["value"])';
    const result = spawnSync('python3', ['-c', script, zip, JSON.stringify(entries)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(directory, 'out');
    await mkdir(output);
    await run({ zip, output, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('installed archive extractor rejects escaping symlinks', async () => {
  await archive(
    [{ name: 'escape', value: '../outside.txt', link: true }],
    async ({ zip, output }) => {
      await assert.rejects(extract(zip, { dir: output }), /Out of bound/);
    },
  );
});
test('installed archive extractor refuses writes through an existing final-component symlink', async () => {
  await archive([{ name: 'victim', value: 'overwrite' }], async ({ zip, output, directory }) => {
    const outside = path.join(directory, 'outside.txt');
    await writeFile(outside, 'untouched');
    await symlink(outside, path.join(output, 'victim'));
    await assert.rejects(extract(zip, { dir: output }));
    assert.equal(await readFile(outside, 'utf8'), 'untouched');
  });
});
test('installed archive extractor rejects duplicate symlink then file entries', async () => {
  await archive(
    [
      { name: 'victim', value: 'inside', link: true },
      { name: 'victim', value: 'overwrite' },
    ],
    async ({ zip, output }) => {
      await assert.rejects(extract(zip, { dir: output }));
    },
  );
});
test('installed archive extractor preserves ordinary nested files and confined symlinks', async () => {
  await archive(
    [
      { name: 'nested/file.txt', value: 'safe' },
      { name: 'link', value: 'nested/file.txt', link: true },
    ],
    async ({ zip, output }) => {
      await extract(zip, { dir: output });
      assert.equal(await readFile(path.join(output, 'link'), 'utf8'), 'safe');
    },
  );
});

test('installed archive extractor refuses symlink directory traversal', async () => {
  await archive(
    [{ name: 'nested/victim', value: 'overwrite' }],
    async ({ zip, output, directory }) => {
      const outside = path.join(directory, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'victim'), 'untouched');
      await symlink(outside, path.join(output, 'nested'));
      await assert.rejects(extract(zip, { dir: output }));
      assert.equal(await readFile(path.join(outside, 'victim'), 'utf8'), 'untouched');
    },
  );
});
test('installed archive extractor rejects traversal paths and unbounded symlink payloads', async () => {
  for (const entry of [
    { name: '../outside.txt', value: 'overwrite' },
    { name: 'link', value: '/tmp/outside.txt', link: true },
    { name: 'link', value: 'x'.repeat(5000), link: true },
  ]) {
    await archive([entry], async ({ zip, output }) => {
      await assert.rejects(extract(zip, { dir: output }));
    });
  }
});
