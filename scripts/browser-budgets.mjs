import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function checkBrowserBudgets(directory = root) {
  const results = [];
  for (const app of ['agent-web', 'designer-web']) {
    const dist = path.join(directory, 'apps', app, 'dist');
    const html = await readFile(path.join(dist, 'index.html'), 'utf8');
    const names = (await readdir(path.join(dist, 'assets'))).filter((name) => name.endsWith('.js'));
    if (!names.length) throw new Error(`${app}: no built JavaScript chunks`);
    for (const name of names) {
      const size = (await stat(path.join(dist, 'assets', name))).size;
      if (app === 'designer-web' && /^elk-worker\.min-[\w-]+\.js$/.test(name)) {
        if (html.includes(name)) throw new Error('ELK worker must not be an HTML entry script');
        for (const peer of names.filter((peer) => peer !== name)) {
          const source = await readFile(path.join(dist, 'assets', peer), 'utf8');
          const escaped = name.replaceAll('.', '\\.');
          if (new RegExp(`(?:from\\s*|import\\s*\\()\\s*["'][^"']*${escaped}`).test(source))
            throw new Error('ELK must remain a separately requested worker');
        }
        results.push({ app, name, size, kind: 'layout-worker' });
        continue;
      }
      if (size > 500000)
        throw new Error(
          `${app}/${name}: ${size} bytes exceeds 500000-byte JavaScript chunk budget`,
        );
      results.push({ app, name, size, kind: 'chunk' });
    }
  }
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await checkBrowserBudgets();
  for (const app of ['agent-web', 'designer-web']) {
    const rows = results.filter((row) => row.app === app && row.kind === 'chunk');
    console.info(
      `${app}: ${rows.length} chunks; largest ${Math.max(...rows.map((row) => row.size))} bytes <= 500000`,
    );
  }
  for (const row of results.filter((row) => row.kind === 'layout-worker'))
    console.info(`${row.app}: on-demand layout worker ${row.size} bytes`);
}
