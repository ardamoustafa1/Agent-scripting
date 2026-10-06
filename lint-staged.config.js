import path from 'node:path';

// Check source with its nearest workspace config. Archived evidence is immutable;
// generated outputs are ignored by the corresponding workspace/Prettier config.
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export default (files) => {
  const source = files.filter((file) => {
    const relative = path.relative(import.meta.dirname, file).replaceAll(path.sep, '/');
    return (
      /\.(ts|tsx|js|mjs|cjs)$/.test(file) &&
      (!relative.includes('/') || /^(apps|packages|scripts|tests)\//.test(relative))
    );
  });
  const formatted = files.filter((file) => {
    const relative = path.relative(import.meta.dirname, file).replaceAll(path.sep, '/');
    return (
      !relative.startsWith('docs/') &&
      relative !== 'CLAUDE.md' &&
      /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|css|html)$/.test(file)
    );
  });
  return [
    ...(source.length
      ? [
          `eslint --flag v10_config_lookup_from_file --no-warn-ignored --max-warnings=0 --fix ${source.map(quote).join(' ')}`,
        ]
      : []),
    ...(formatted.length ? [`prettier --write ${formatted.map(quote).join(' ')}`] : []),
  ];
};
