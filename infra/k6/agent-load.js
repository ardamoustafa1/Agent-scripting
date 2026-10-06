import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import { loadProfile, loadSettings, summarize, thresholdsFor } from './profile.js';

// Secret fixture remains outside Git. Provision through normal admin/SSO/simulator workflows.
const agents = new SharedArray('synthetic agents', () => {
  const items = JSON.parse(open(__ENV.K6_AGENT_FIXTURE)).agents;
  loadProfile(__ENV, items, 'interaction'); // Validate all identities once, inside shared initialization.
  return items;
});
const profile = loadSettings(__ENV, 'interaction');
const { base, apiBase, count, rounds } = profile;
const completed = new Counter('verbis_interactions_completed');
const pages = new Counter('verbis_pages_visited');
const calls = new Counter('verbis_web_services_called');
const openDuration = new Trend('verbis_agent_api_open_ms', true);
export const options = {
  scenarios: {
    agents: {
      executor: 'per-vu-iterations',
      vus: count,
      iterations: rounds,
      maxDuration: profile.maxDuration,
    },
  },
  tlsAuth: [
    {
      domains: [profile.host],
      cert: open(__ENV.K6_CLIENT_CERT),
      key: open(__ENV.K6_CLIENT_KEY),
    },
  ],
  // Do not persist URLs containing identifiers in the results.
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  thresholds: thresholdsFor(profile),
};
let token;
let expires = 0;
let start;
function read(response, name) {
  if (!check(response, { [name]: (res) => res.status >= 200 && res.status < 300 }))
    fail(`Failed step: ${name}; status ${response.status}`);
  return response.status === 204 ? null : response.json();
}
function serviceToken(agent) {
  if (token && Date.now() < expires) return token;
  const res = http.post(
    `${apiBase}/oauth2/${agent.tenantSlug}/token`,
    { grant_type: 'client_credentials', client_id: agent.clientId },
    { tags: { name: 'oauth.client-credentials' } },
  );
  const body = read(res, 'service token');
  token = body.access_token;
  expires = Date.now() + Math.max(0, body.expires_in - 30) * 1000;
  return token;
}
export default function () {
  const agent = agents[exec.vu.idInTest - 1];
  const round = exec.vu.iterationInScenario;
  if (start === undefined) start = Date.now();
  // One interaction per 180-second slot; keep all requested VUs through idle periods.
  const slot = start + round * 180000;
  if (Date.now() < slot) sleep((slot - Date.now()) / 1000);
  const interaction = agent.interactionIds[round];
  if (!interaction || agent.pageIds.length !== 5 || agent.sources.length !== 3)
    fail(
      'Fixture requires fresh interactions, five pages and three real mock-upstream definitions',
    );
  const headers = {
    Origin: base,
    Cookie: agent.cookie,
    'x-csrf-token': agent.csrf,
    'content-type': 'application/json',
  };
  const post = (path, body, name, auth = headers) =>
    read(
      http.post(`${apiBase}${path}`, JSON.stringify(body), {
        headers: auth,
        tags: { name },
        timeout: '10s',
      }),
      name,
    );
  const intent = post(
    '/v1/launch-intents',
    {
      connectorId: agent.connectorId,
      interactionId: interaction,
      userId: agent.userId,
      delivery: 'fragment',
    },
    'launch.intent',
    { Authorization: `Bearer ${serviceToken(agent)}`, 'content-type': 'application/json' },
  );
  const opened = Date.now();
  const session = post('/v1/launch/redeem', { code: intent.code }, 'launch.redeem');
  const path = `/v1/sessions/${session.sessionId}`;
  read(
    http.get(`${apiBase}${path}/desktop`, { headers, tags: { name: 'session.desktop' } }),
    'desktop',
  );
  const tabId = '01928f3a-0000-7000-8000-000000000001';
  let view = post(`${path}/attach`, { tabId }, 'session.attach');
  if (!view.writeToken || view.readOnly) fail('Writer lease was not granted');
  const writeToken = view.writeToken;
  const claim = () => ({ tabId, writeToken, expectedSequence: view.sequence });
  view = post(
    `${path}/commands`,
    { ...claim(), command: { type: 'transition', state: 'active' } },
    'session.activate',
  );
  openDuration.add(Date.now() - opened);
  for (let i = 0; i < 5; i++) {
    view = post(
      `${path}/commands`,
      { ...claim(), command: { type: 'page', pageId: agent.pageIds[i] } },
      'session.page',
    );
    pages.add(1);
    if (i < 3) {
      const source = agent.sources[i];
      const result = post(
        `${path}/desktop/data-source`,
        { ...claim(), sourceId: source.id, input: source.input },
        'session.web-service',
      );
      view = result.view;
      calls.add(1);
    }
  }
  view = post(
    `${path}/commands`,
    { ...claim(), command: { type: 'transition', state: 'wrapup' } },
    'session.wrapup',
  );
  view = post(
    `${path}/outcome`,
    { ...claim(), code: agent.outcomeCode, fields: {}, subCodes: [] },
    'session.outcome',
  );
  // Completion means API acceptance; connector ACK is monitored independently.
  completed.add(1);
  const next = slot + 180000;
  if (Date.now() < next) sleep((next - Date.now()) / 1000);
}
export function handleSummary(data) {
  const results = summarize(profile, data);
  return { [__ENV.K6_RESULTS || 'test-results/k6-agent.json']: JSON.stringify(results, null, 2) };
}
