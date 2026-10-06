import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createApiProgram, inventoryRoutes, repository } from './audit-route-inventory.mjs';
import { catalogInventory } from './i18n-inventory.mjs';

// Deliberately narrow: home-realm discovery reads providers and never changes domain state.
const readOnly = new Set(['POST /auth/discover']);
// Transient gateway wire packets are not domain writes. Their result is audited by the engine;
// persisting transport bodies in the generic request audit would duplicate sensitive payloads.
const transportOnly = new Set([
  'POST /v1/private-egress/jobs/claim',
  'POST /v1/private-egress/jobs/:id/complete',
]);
test('every mutation-shaped controller route maps to a transaction audit or explicit audit call', () => {
  const routes = inventoryRoutes(createApiProgram());
  assert.ok(routes.length > 100, 'Controller discovery unexpectedly shrank');
  const report = JSON.parse(
    readFileSync(new URL('../docs/audit-routes.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    report.routes,
    routes,
    'Regenerate the reviewed route inventory after route changes',
  );
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    assert.notEqual(
      route.method,
      'ALL',
      'All-method handlers need explicit mutating-method coverage',
    );
    if (readOnly.has(key)) {
      assert.equal(route.handler, 'discover');
      assert.deepEqual(route.decorators, ['Public']);
      continue;
    }
    if (transportOnly.has(key)) {
      assert.equal(route.controller, 'PrivateEgressController');
      assert.deepEqual(route.decorators, ['SkipAudit']);
      assert.equal(route.strategy, 'explicit');
      continue;
    }
    assert.ok(route.auditEvidence.length > 0, `${key} has no reachable AuditService call`);
  }
  const module = readFileSync(repository + 'apps/api/src/app.module.ts', 'utf8');
  const order = [
    'AuditFailureInterceptor',
    'TenantTransactionInterceptor',
    'IdempotencyInterceptor',
    'AuditTrailInterceptor',
  ].map((name) =>
    module.indexOf(
      `provide: APP_INTERCEPTOR, ${name === 'TenantTransactionInterceptor' || name === 'IdempotencyInterceptor' ? 'useClass' : 'useExisting'}: ${name}`,
    ),
  );
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'Audit trail must run inside the request transaction',
  );
});
test('TR/EN catalogs contain every literal production translation key and identical nonempty leaves', () => {
  const result = catalogInventory();
  assert.deepEqual(result.trKeys, result.enKeys);
  assert.deepEqual(result.empty, []);
  assert.deepEqual(result.missing, []);
});

test('transient gateway audit exceptions retain certificate authorization and audited execution', () => {
  const controller = readFileSync(
    repository + 'apps/api/src/modules/integrations/private-egress.controller.ts',
    'utf8',
  );
  assert.equal(controller.match(/@Can\('execute', 'Integration'\)/g)?.length, 2);
  assert.equal(controller.match(/@NoResponseReplay\(\)/g)?.length, 2);
  const gateway = readFileSync(
    repository + 'apps/api/src/modules/integrations/private-egress.service.ts',
    'utf8',
  );
  assert.match(gateway, /p\?\.type !== 'service'/);
  assert.match(gateway, /!p\.certificateThumbprint/);
  assert.match(gateway, /!p\.scopes\.includes\('execute:Integration'\)/);
  const engine = readFileSync(
    repository + 'apps/api/src/modules/integrations/integration-engine.service.ts',
    'utf8',
  );
  assert.match(
    engine,
    /await this\.audit\.record\(tx, \{\s*action: 'integration\.datasource\.executed'/,
  );
});
