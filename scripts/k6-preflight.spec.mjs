import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
const fixture = {
  agents: [1, 2].map((n) => ({
    userId: `01928f3a-0000-7000-8000-00000000000${n}`,
    sessionId: `01928f3a-0000-7000-8000-00000000001${n}`,
    cookie: `__Host-verbis_session=synthetic-secret-${n}`,
    csrf: `synthetic-csrf-${n}`,
    tenantSlug: 'synthetic',
    clientId: 'staging',
    connectorId: '01928f3a-0000-7000-8000-000000000099',
    interactionIds: [`01928f3a-0000-7000-8000-00000000002${n}`],
    pageIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
    sources: [1, 2, 3].map((i) => ({ id: `source-${i}`, input: {} })),
    outcomeCode: 'complete',
  })),
};
function withFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'verbis-load-preflight-'));
  const path = join(directory, 'fixture.json');
  writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 });
  const env = {
    ...process.env,
    K6_AGENT_FIXTURE: path,
    K6_BASE_URL: 'https://staging.example',
    K6_AGENTS: '2',
    K6_ROUNDS: '1',
    K6_SOAK_SECONDS: '1',
  };
  try {
    run({ directory, path, env });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function cli(env) {
  return spawnSync(process.execPath, ['scripts/k6-preflight.mjs', 'socket'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}
test('private preflight exits successfully without exposing credentials or sending traffic', () =>
  withFixture(({ env }) => {
    const result = cli(env);
    assert.equal(result.status, 0, 'k6 init must accept the validated profile');
    const output = JSON.parse(result.stdout);
    assert.equal(output.networkRequests, 0);
    assert.equal(output.profile.count, 2);
    assert.ok(!result.stdout.includes('synthetic-secret'));
    assert.ok(!result.stdout.includes('synthetic-csrf'));
    assert.ok(!result.stdout.includes(env.K6_AGENT_FIXTURE));
  }));
test('preflight rejects malformed JSON without leaking embedded secrets', () =>
  withFixture(({ path, env }) => {
    writeFileSync(path, '{"secret":"do-not-print-this-secret');
    const result = cli(env);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('do-not-print'));
    assert.ok(!result.stderr.includes(path));
  }));
test('preflight rejects publicly readable credential files', () =>
  withFixture(({ path, env }) => {
    chmodSync(path, 0o644);
    assert.equal(cli(env).status, 1);
  }));
test('preflight rejects duplicate authenticated agents', () =>
  withFixture(({ path, env }) => {
    writeFileSync(path, JSON.stringify({ agents: [fixture.agents[0], fixture.agents[0]] }));
    assert.equal(cli(env).status, 1);
  }));
const hasK6 = spawnSync('k6', ['version'], { encoding: 'utf8' }).status === 0;
test(
  'real k6 init validates both complete load scripts without executing requests',
  { skip: !hasK6 },
  () =>
    withFixture(({ directory, env }) => {
      const certificate = join(directory, 'inspect-cert.pem');
      const key = join(directory, 'inspect-key.pem');
      // Ephemeral self-signed test identity, never trusted by staging; no network requests.
      const generated = spawnSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-subj',
          '/CN=synthetic-k6-inspect',
          '-keyout',
          key,
          '-out',
          certificate,
          '-days',
          '1',
        ],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(generated.status, 0, 'ephemeral test certificate generation');
      chmodSync(key, 0o600);
      for (const file of ['agent-load.js', 'agent-socket-soak.js']) {
        const result = spawnSync(
          'k6',
          ['inspect', '--include-system-env-vars', `infra/k6/${file}`],
          {
            env: { ...env, K6_CLIENT_CERT: certificate, K6_CLIENT_KEY: key },
            encoding: 'utf8',
            timeout: 20000,
          },
        );
        assert.equal(result.status, 0, 'k6 init must accept the validated profile');
        const options = JSON.parse(result.stdout);
        assert.equal(Object.values(options.scenarios)[0].vus, 2);
      }
    }),
);
for (const partial of [false, true]) {
  test(
    `real k6 offline metric harness ${partial ? 'fails incomplete counts' : 'passes complete counts'}`,
    { skip: !hasK6 },
    () =>
      withFixture(({ directory, env }) => {
        const script = join(directory, 'metric-harness.js');
        const resultPath = join(directory, 'result.json');
        writeFileSync(
          script,
          `
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { loadProfile, summarize, thresholdsFor } from ${JSON.stringify(resolve('infra/k6/profile.js'))};
const profile = loadProfile(__ENV, JSON.parse(open(__ENV.K6_AGENT_FIXTURE)).agents, 'socket');
const connected = new Counter('runtime_socket_connected');
const closed = new Counter('runtime_socket_unexpected_close');
const held = new Trend('runtime_socket_held_seconds');
export const options = { scenarios: { harness: { executor: 'per-vu-iterations', vus: 2, iterations: 1 } }, thresholds: thresholdsFor(profile) };
export default function () {
  connected.add(${partial ? 'exec.vu.idInTest === 1 ? 1 : 0' : '1'});
  closed.add(0); held.add(1); check(true, { 'synthetic metric only': (value) => value });
}
export function handleSummary(data) { return { [__ENV.K6_RESULTS]: JSON.stringify(summarize(profile, data)) }; }
`,
          { mode: 0o600 },
        );
        const run = spawnSync('k6', ['run', '--quiet', '--no-color', script], {
          env: { ...env, K6_RESULTS: resultPath },
          encoding: 'utf8',
          timeout: 20000,
        });
        assert.equal(run.status, partial ? 99 : 0, 'k6 exit status must reflect thresholds');
        const report = JSON.parse(readFileSync(resultPath, 'utf8'));
        assert.equal(report.accepted, !partial);
        assert.equal(report.expected.connected, 2);
        assert.equal(report.observed.connected, partial ? 1 : 2);
        assert.ok(!JSON.stringify(report).includes('synthetic-secret'));
      }),
  );
}
