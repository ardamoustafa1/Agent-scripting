import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const dimensions = ['lines', 'statements', 'functions', 'branches'];
export function checkSummary(summary, floor, label) {
  if (!summary || typeof summary !== 'object' || !summary.total) return [`${label}: missing total`];
  return dimensions.flatMap((metric) => {
    const entry = summary.total[metric];
    if (!entry || !Number.isFinite(entry.pct) || !Number.isFinite(entry.total) || entry.total <= 0)
      return [`${label}: empty or invalid ${metric} coverage`];
    return entry.pct < floor ? [`${label}: ${metric} ${entry.pct}% < ${floor}%`] : [];
  });
}
export const criticalApiScopes = [
  'modules/launch/',
  'modules/authz/',
  'modules/audit/',
  'modules/integrations/engine/transport.ts',
  'modules/identity/egress/idp-fetch.ts',
];
export const criticalBranchScopes = [
  'modules/launch/',
  'modules/authz/',
  'modules/audit/core/',
  'modules/audit/audit.repository.ts',
  'modules/integrations/engine/transport.ts',
  'modules/integrations/engine/vault.ts',
  'modules/integrations/engine/vault-transit-client.ts',
  'modules/identity/egress/idp-fetch.ts',
];
export function checkCriticalApiCoverage(summary) {
  const check = (scope, dimension, floor) => {
    const rows = Object.entries(summary).filter(([file]) =>
      file.replaceAll('\\', '/').includes(`/src/${scope}`),
    );
    const valid =
      rows.length > 0 &&
      rows.every(
        ([, row]) =>
          Number.isFinite(row[dimension]?.total) && Number.isFinite(row[dimension]?.covered),
      );
    const total = rows.reduce((sum, [, row]) => sum + (row[dimension]?.total ?? 0), 0);
    const covered = rows.reduce((sum, [, row]) => sum + (row[dimension]?.covered ?? 0), 0);
    if (!valid || total <= 0)
      return [`api/${scope}: missing security-critical ${dimension} coverage`];
    const percent = (100 * covered) / total;
    return percent < floor ? [`api/${scope}: ${dimension} ${percent.toFixed(2)}% < ${floor}%`] : [];
  };
  return [
    ...criticalApiScopes.flatMap((scope) => check(scope, 'lines', 95)),
    ...criticalBranchScopes.flatMap((scope) => check(scope, 'branches', 90)),
  ];
}
export async function checkCoverage(directory = root) {
  const errors = [],
    results = [];
  for (const group of ['packages', 'apps']) {
    for (const name of await readdir(path.join(directory, group))) {
      const workspace = path.join(directory, group, name);
      // Configuration-only workspaces have no Vitest runtime suite.
      try {
        await stat(path.join(workspace, 'vitest.config.ts'));
      } catch {
        continue;
      }
      const floor =
        group === 'packages'
          ? name === 'expr'
            ? 95
            : 90
          : name === 'api'
            ? 85
            : name.endsWith('-web')
              ? 80
              : 75;
      const label = `${group}/${name}`;
      try {
        const summary = JSON.parse(
          await readFile(path.join(workspace, 'coverage/coverage-summary.json'), 'utf8'),
        );
        errors.push(...checkSummary(summary, floor, label));
        if (group === 'apps' && name === 'api') errors.push(...checkCriticalApiCoverage(summary));
        results.push({ workspace: label, floor, total: summary.total });
      } catch (error) {
        errors.push(
          `${label}: required coverage report unavailable (${error.code ?? 'invalid JSON'})`,
        );
      }
    }
  }
  if (results.length === 0) errors.push('No coverage reports found');
  return { errors, results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, results } = await checkCoverage();
  for (const row of results)
    console.info(
      `${row.workspace}: ${dimensions.map((d) => `${d}=${row.total[d]?.pct}%`).join(' ')}`,
    );
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
}
