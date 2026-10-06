import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
function catalog(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const result = new Map();
  const unwrap = (node) =>
    ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
      ? unwrap(node.expression)
      : node;
  const walk = (raw, prefix) => {
    const node = unwrap(raw);
    if (ts.isStringLiteralLike(node)) {
      result.set(prefix, node.text);
      return;
    }
    if (!ts.isObjectLiteralExpression(node))
      throw new Error('Translation catalogs must contain literal objects/strings');
    for (const item of node.properties) {
      if (!ts.isPropertyAssignment(item) || !item.name || ts.isComputedPropertyName(item.name))
        throw new Error('Computed catalog keys need explicit inventory support');
      const key = item.name.text;
      walk(item.initializer, prefix ? prefix + '.' + key : key);
    }
  };
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((item) => item.declarationList.declarations)[0];
  if (!declaration?.initializer) throw new Error('Catalog export is missing');
  walk(declaration.initializer, '');
  return result;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    if (['node_modules', 'dist', '.astro', '.turbo', 'coverage', 'generated'].includes(item.name))
      return [];
    const file = path.join(dir, item.name);
    return item.isDirectory()
      ? files(file)
      : /\.(ts|tsx)$/.test(file) &&
          !/\.(spec|test|stories)\.|\/e2e\/|\/test\/|\/prisma\//.test(file)
        ? [file]
        : [];
  });
}
export function catalogInventory() {
  const tr = catalog(root + 'packages/i18n/src/locales/tr.ts');
  const en = catalog(root + 'packages/i18n/src/locales/en.ts');
  const missing = [],
    dynamic = [],
    used = new Set();
  for (const file of [...files(root + 'apps'), ...files(root + 'packages')]) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : '';
        if (name === 't' || name === 'text') {
          const arg = node.arguments[0];
          const location = {
            file: path.relative(root, file).replaceAll(path.sep, '/'),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          };
          if (arg && ts.isStringLiteralLike(arg)) {
            // text() can also read script-specific messages. Global components/runtime keys are shared.
            if (name === 't' || /^(components|runtime)\./.test(arg.text)) {
              used.add(arg.text);
              if (!tr.has(arg.text) || !en.has(arg.text))
                missing.push({ key: arg.text, ...location });
            }
          } else dynamic.push(location);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return {
    trKeys: [...tr.keys()].sort(),
    enKeys: [...en.keys()].sort(),
    empty: [...tr, ...en].filter(([, value]) => !value.trim()).map(([key]) => key),
    missing,
    literalKeyCount: used.size,
    dynamic,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = catalogInventory();
  fs.writeFileSync(
    root + 'docs/i18n-inventory.json',
    JSON.stringify({ testsExecuted: false, ...report }, null, 2) + '\n',
  );
  process.stdout.write(
    `${report.trKeys.length} TR / ${report.enKeys.length} EN keys; ${report.literalKeyCount} literal usages inventoried.\n`,
  );
  for (const item of report.missing)
    process.stdout.write(`${item.file}:${item.line} ${item.key}\n`);
}
