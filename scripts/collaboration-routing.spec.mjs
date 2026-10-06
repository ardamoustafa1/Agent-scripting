import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
test('room REST and WebSocket routes share the dedicated owner and strip certificate proof', async () => {
  for (const file of ['deploy/nginx-compose.conf', 'deploy/helm/verbis/files/nginx.conf']) {
    const source = await readFile(file, 'utf8');
    const rest = source.slice(
      source.indexOf('location ~ ^/api/v1/scripts/'),
      source.indexOf('  location /api/'),
    );
    const socket = source.slice(
      source.indexOf('  location /collaboration'),
      source.indexOf('  location /assets/'),
    );
    assert.match(rest, /collaboration[^\n]*:4000/);
    assert.match(socket, /collaboration[^\n]*:4010/);
    for (const route of [rest, socket]) {
      assert.match(route, /proxy_set_header ssl-client-cert ""/);
      assert.match(route, /proxy_set_header x-verbis-mtls-proxy-secret ""/);
      assert.match(route, /proxy_set_header Origin \$http_origin/);
    }
    assert.match(rest, /rewrite \^\/api/);
  }
  const workloads = await readFile('deploy/helm/verbis/templates/workloads.yaml', 'utf8');
  assert.match(workloads, /"collaboration"[^\n]*ne \(int \$svc.replicas\) 1/);
});
