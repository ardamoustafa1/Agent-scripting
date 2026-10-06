import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProfile, summarize } from './profile.js';
const uuid = (n) => `01928f3a-0000-7000-8000-${String(n).padStart(12, '0')}`;
const agent = (n) => ({
  userId: uuid(n),
  sessionId: uuid(n + 10),
  cookie: `__Host-verbis_session=synthetic-${n}; theme=light`,
  csrf: `synthetic-csrf-${n}`,
  tenantSlug: 'synthetic',
  clientId: 'staging',
  connectorId: uuid(99),
  interactionIds: [uuid(n + 20), uuid(n + 30)],
  pageIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
  sources: [1, 2, 3].map((i) => ({ id: `source-${i}`, input: {} })),
  outcomeCode: 'complete',
});
const env = { K6_BASE_URL: 'https://staging.example:443', K6_AGENTS: '2', K6_ROUNDS: '2' };
for (const field of ['userId', 'sessionId', 'cookie']) {
  test(`rejects duplicated ${field} before creating load`, () => {
    const agents = [agent(1), agent(2)];
    agents[1][field] = agents[0][field];
    assert.throws(() => loadProfile(env, agents, 'socket'));
  });
}
test('rejects identical BFF session hidden by different extra cookies', () => {
  const agents = [agent(1), agent(2)];
  agents[1].cookie = '__Host-verbis_session=synthetic-1; theme=dark';
  assert.throws(() => loadProfile(env, agents, 'socket'));
});
for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '']) {
  test(`rejects invalid agent count ${JSON.stringify(value)}`, () =>
    assert.throws(() => loadProfile({ ...env, K6_AGENTS: value }, [agent(1), agent(2)], 'socket')));
}
for (const base of [
  'http://staging.example',
  'https://user:secret@staging.example',
  'https://staging.example/path',
  'https://staging.example?token=secret',
  'https://staging.example#x',
]) {
  test('rejects unsafe origin without echoing credentials', () => {
    assert.throws(
      () => loadProfile({ ...env, K6_BASE_URL: base }, [agent(1), agent(2)], 'socket'),
      (error) => !error.message.includes('secret') && !error.message.includes(base),
    );
  });
}
test('rejects missing socket session before any network call', () => {
  const item = agent(1);
  delete item.sessionId;
  assert.throws(() => loadProfile({ ...env, K6_AGENTS: '1' }, [item], 'socket'));
});
test('rejects reused interactions across users and rounds', () => {
  const agents = [agent(1), agent(2)];
  agents[1].interactionIds[1] = agents[0].interactionIds[0];
  assert.throws(() => loadProfile(env, agents, 'interaction'));
});
test('rejects example placeholder credentials', () => {
  const item = agent(1);
  item.csrf = 'REPLACE_FROM_SYNTHETIC_SSO';
  assert.throws(() => loadProfile({ ...env, K6_AGENTS: '1' }, [item], 'socket'));
});
test('long soak gets a sufficient executor deadline', () => {
  const profile = loadProfile({ ...env, K6_SOAK_SECONDS: '7200' }, [agent(1), agent(2)], 'socket');
  assert.equal(profile.maxDuration, '7500s');
});
test('valid profiles contain only configuration, never fixture secrets', () => {
  const profile = loadProfile(env, [agent(1), agent(2)], 'socket');
  assert.equal(profile.count, 2);
  assert.ok(!JSON.stringify(profile).includes('synthetic-1'));
});
test('partial run reports measured completed interactions separately from requested', () => {
  const profile = loadProfile(env, [agent(1), agent(2)], 'interaction');
  const result = summarize(profile, {
    metrics: { verbis_interactions_completed: { values: { count: 1 } } },
  });
  assert.equal(result.expected.interactions, 4);
  assert.equal(result.observed.interactions, 1);
  assert.equal(result.accepted, false);
});
test('missing measurement cannot pass acceptance', () => {
  const result = summarize(loadProfile(env, [agent(1), agent(2)], 'socket'), { metrics: {} });
  assert.equal(result.accepted, false);
  assert.equal(result.observed.connected, null);
});

test('all required thresholds and counts must pass, and a failing threshold revokes acceptance', () => {
  const profile = loadProfile(env, [agent(1), agent(2)], 'socket');
  const metric = (values, expression, ok = true) => ({
    values,
    thresholds: { [expression]: { ok } },
  });
  const data = {
    metrics: {
      checks: metric({ rate: 1 }, 'rate==1'),
      iterations: metric({ count: 2 }, 'count==2'),
      runtime_socket_connected: metric({ count: 2 }, 'count==2'),
      runtime_socket_unexpected_close: metric({ count: 0 }, 'count==0'),
      runtime_socket_held_seconds: metric({ min: 3600 }, 'min>=3599'),
    },
  };
  assert.equal(summarize(profile, data).accepted, true);
  data.metrics.iterations.thresholds['count==2'].ok = false;
  assert.equal(summarize(profile, data).accepted, false);
  delete data.metrics.iterations.thresholds;
  assert.equal(summarize(profile, data).accepted, false);
});
for (const field of ['K6_ROUNDS', 'K6_SOAK_SECONDS']) {
  test(`validates ${field} before network operations`, () => {
    for (const value of ['NaN', '-1', '0', 'Infinity', '1.5', ''])
      assert.throws(() => loadProfile({ ...env, [field]: value }, [agent(1), agent(2)], 'socket'));
  });
}
test('rejects reused interactions within the same agent', () => {
  const item = agent(1);
  item.interactionIds[1] = item.interactionIds[0];
  assert.throws(() => loadProfile({ ...env, K6_AGENTS: '1' }, [item], 'interaction'));
});
test('rejects incomplete or duplicated page/REST definitions', () => {
  for (const field of ['pageIds', 'sources']) {
    const item = agent(1);
    item[field][1] = item[field][0];
    assert.throws(() => loadProfile({ ...env, K6_AGENTS: '1' }, [item], 'interaction'));
  }
});
test('supports explicit secure custom cookie names', () => {
  const agents = [agent(1), agent(2)].map((item) => ({
    ...item,
    cookie: item.cookie.replace('__Host-verbis_session', '__Host-company'),
  }));
  assert.equal(
    loadProfile({ ...env, K6_SESSION_COOKIE_NAME: '__Host-company' }, agents, 'socket').count,
    2,
  );
});

test('HTTP workload uses the production edge API prefix and keeps websocket origin separate', () => {
  const profile = loadProfile(env, [agent(1), agent(2)], 'socket');
  assert.equal(profile.apiBase, `${env.K6_BASE_URL}/api`);
  assert.equal(profile.base, env.K6_BASE_URL);
  assert.equal(
    loadProfile({ ...env, K6_API_PREFIX: '' }, [agent(1), agent(2)], 'socket').apiBase,
    env.K6_BASE_URL,
  );
  assert.throws(() =>
    loadProfile({ ...env, K6_API_PREFIX: '//other.example' }, [agent(1), agent(2)], 'socket'),
  );
});

test('core default accepts 2000 independent fixture identities and rejects a duplicate at the end', () => {
  const agents = Array.from({ length: 2000 }, (_, index) => agent(index + 1));
  const target = { K6_BASE_URL: 'https://staging.example' };
  assert.equal(loadProfile(target, agents, 'socket').count, 2000);
  agents[1999].sessionId = agents[0].sessionId;
  assert.throws(() => loadProfile(target, agents, 'socket'));
});
