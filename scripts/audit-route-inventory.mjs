/** Static audit reachability, never evidence of successful runtime/branch coverage. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const repository = fileURLToPath(new URL('../', import.meta.url));
export function createApiProgram(root = repository) {
  const configPath = path.join(root, 'apps/api/tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error('Cannot read API TypeScript configuration');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
}
function decorators(node) {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : []) ?? [];
}
function named(node, checker) {
  return decorators(node).map((item) => {
    const expression = item.expression;
    const callee = ts.isCallExpression(expression) ? expression.expression : expression;
    let symbol = checker.getSymbolAtLocation(callee);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return {
      name: symbol?.name ?? callee.getText(),
      args: ts.isCallExpression(expression) ? expression.arguments : [],
    };
  });
}
function strings(node) {
  if (!node) return [''];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(strings);
  throw new Error('Computed route requires explicit scanner support: ' + node.getText());
}
export function inventoryRoutes(program, root = repository) {
  const checker = program.getTypeChecker();
  const memo = new Map();
  function auditPaths(declaration, seen = new Set()) {
    if (!declaration || !('body' in declaration) || !declaration.body) return [];
    if (memo.has(declaration)) return memo.get(declaration);
    if (seen.has(declaration)) return [];
    const next = new Set(seen).add(declaration);
    const found = new Set();
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const target = checker.getResolvedSignature(node)?.declaration;
        const source = target?.getSourceFile().fileName;
        if (
          source?.endsWith('/modules/audit/audit.service.ts') &&
          target.name?.getText().startsWith('record')
        ) {
          found.add(path.relative(root, source).replaceAll(path.sep, '/'));
        } else if (
          source?.startsWith(path.join(root, 'apps/api/src')) &&
          !source.includes('/generated/')
        ) {
          for (const evidence of auditPaths(target, next)) found.add(evidence);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration.body);
    const result = [...found].sort();
    // Cyclic paths depend on the traversal stack; only cache terminal evidence.
    if (result.length) memo.set(declaration, result);
    return result;
  }
  const routes = [];
  for (const source of program.getSourceFiles()) {
    if (
      !source.fileName.startsWith(path.join(root, 'apps/api/src')) ||
      !source.fileName.endsWith('.controller.ts')
    )
      continue;
    for (const klass of source.statements.filter(ts.isClassDeclaration)) {
      const classDecorators = named(klass, checker);
      const controller = classDecorators.find((item) => item.name === 'Controller');
      if (!controller) continue;
      for (const method of klass.members.filter(ts.isMethodDeclaration)) {
        const methodDecorators = named(method, checker);
        const routeDecorators = methodDecorators.filter((item) =>
          ['Post', 'Put', 'Patch', 'Delete', 'All'].includes(item.name),
        );
        const names = new Set([...classDecorators, ...methodDecorators].map((item) => item.name));
        const ownsAudit =
          names.has('Public') || names.has('SkipAudit') || names.has('OwnTenantTransactions');
        for (const route of routeDecorators)
          for (const prefix of strings(controller.args[0]))
            for (const suffix of strings(route.args[0])) {
              const url =
                '/' +
                [prefix, suffix]
                  .filter(Boolean)
                  .join('/')
                  .replace(/^\/+|\/+$/g, '');
              routes.push({
                method: route.name.toUpperCase(),
                path: url,
                controller: klass.name.text,
                handler: method.name.getText(),
                file: path.relative(root, source.fileName).replaceAll(path.sep, '/'),
                line: source.getLineAndCharacterOfPosition(method.getStart()).line + 1,
                decorators: [...names].filter((name) =>
                  ['Public', 'SkipAudit', 'OwnTenantTransactions'].includes(name),
                ),
                strategy: ownsAudit ? 'explicit' : 'transaction-interceptor',
                auditEvidence: ownsAudit
                  ? auditPaths(method)
                  : ['apps/api/src/modules/audit/audit.interceptors.ts'],
              });
            }
      }
    }
  }
  return routes.sort((a, b) => (a.method + a.path).localeCompare(b.method + b.path));
}
export function writeInventory(destination, root = repository) {
  const routes = inventoryRoutes(createApiProgram(root), root);
  fs.writeFileSync(
    destination,
    JSON.stringify(
      {
        testsExecuted: false,
        interpretation:
          'Static call reachability only; branch, transaction and live endpoint acceptance pending.',
        routes,
      },
      null,
      2,
    ) + '\n',
  );
  return routes;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(repository, 'docs/audit-routes.json');
  const routes = writeInventory(target);
  process.stdout.write(`${routes.length} mutation-shaped routes inventoried; no tests executed.\n`);
  for (const route of routes.filter((item) => item.auditEvidence.length === 0))
    process.stdout.write(`${route.method} ${route.path} — audit reachability unresolved\n`);
}
