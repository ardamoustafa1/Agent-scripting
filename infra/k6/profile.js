// Framework-free validation shared by k6 and Node. Never return or echo fixture credentials.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function integer(env, key, fallback) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${key} must be a positive safe integer`);
  return value;
}
function text(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/[\r\n]/.test(value) &&
    !value.includes('REPLACE_')
  );
}
function distinct(set, value, label) {
  if (set.has(value)) throw new Error(`Duplicate ${label} in selected fixture`);
  set.add(value);
}
export function loadSettings(env, mode) {
  if (!['socket', 'interaction'].includes(mode)) throw new Error('Unknown load profile');
  const base = env.K6_BASE_URL;
  // A single HTTPS origin, no userinfo, paths, fragments or query strings.
  const origin =
    typeof base === 'string' &&
    base.match(/^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i);
  if (!origin || (origin[2] && (+origin[2] < 1 || +origin[2] > 65535)))
    throw new Error('K6_BASE_URL must be a bare staging HTTPS origin');
  let pathPrefix = '/api';
  if (env.K6_API_PREFIX !== undefined) pathPrefix = env.K6_API_PREFIX;
  if (!/^(\/[A-Za-z0-9_-]+)*$/.test(pathPrefix))
    throw new Error('K6_API_PREFIX must be an API path prefix');
  const count = integer(env, 'K6_AGENTS', mode === 'socket' ? 2000 : 5000);
  const rounds = integer(env, 'K6_ROUNDS', 20);
  const duration = integer(env, 'K6_SOAK_SECONDS', 3600);
  const seconds = mode === 'socket' ? duration : rounds * 180;
  if (!Number.isSafeInteger(seconds + 300) || !Number.isSafeInteger(count * rounds * 5))
    throw new Error('Load profile arithmetic exceeds safe range');
  const cookieName = env.K6_SESSION_COOKIE_NAME || '__Host-verbis_session';
  if (!/^__Host-[A-Za-z0-9_-]+$/.test(cookieName))
    throw new Error('A secure BFF session cookie name is required');
  return {
    apiBase: base + pathPrefix,
    base,
    host: origin[1],
    count,
    rounds,
    duration,
    mode,
    maxDuration: `${seconds + 300}s`,
  };
}
export function loadProfile(env, agents, mode) {
  const profile = loadSettings(env, mode);
  const { count, rounds } = profile;
  const cookieName = env.K6_SESSION_COOKIE_NAME || '__Host-verbis_session';
  if (!agents || !Number.isSafeInteger(agents.length) || agents.length < count)
    throw new Error('One independent SSO fixture per requested agent is required');
  const users = new Set(),
    sessions = new Set(),
    credentials = new Set(),
    interactions = new Set();
  for (let i = 0; i < count; i++) {
    const agent = agents[i];
    if (!agent || !uuid.test(agent.userId || '') || !text(agent.cookie) || !text(agent.csrf))
      throw new Error('Fixture requires a UUID user, SSO cookie and CSRF token');
    distinct(users, agent.userId.toLowerCase(), 'user');
    const values = agent.cookie
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${cookieName}=`));
    if (
      values.length !== 1 ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(values[0].slice(cookieName.length + 1))
    )
      throw new Error('Fixture requires one valid secure BFF session cookie');
    distinct(credentials, values[0].slice(cookieName.length + 1), 'BFF session');
    if (mode === 'socket') {
      if (!uuid.test(agent.sessionId || ''))
        throw new Error('Socket fixture requires a securely launched session UUID');
      distinct(sessions, agent.sessionId.toLowerCase(), 'runtime session');
    } else {
      if (
        !text(agent.tenantSlug) ||
        !/^[A-Za-z0-9_-]+$/.test(agent.tenantSlug) ||
        !text(agent.clientId) ||
        !uuid.test(agent.connectorId || '') ||
        !text(agent.outcomeCode)
      )
        throw new Error('Interaction fixture requires service launch and outcome configuration');
      if (!Array.isArray(agent.interactionIds) || agent.interactionIds.length < rounds)
        throw new Error('Fresh interaction UUIDs required for every requested round');
      for (const id of agent.interactionIds.slice(0, rounds)) {
        if (!uuid.test(id || '')) throw new Error('Invalid interaction UUID');
        distinct(interactions, id.toLowerCase(), 'interaction');
      }
      if (
        !Array.isArray(agent.pageIds) ||
        agent.pageIds.length !== 5 ||
        !agent.pageIds.every(text) ||
        new Set(agent.pageIds).size !== 5
      )
        throw new Error('Five distinct published pages required');
      if (
        !Array.isArray(agent.sources) ||
        agent.sources.length !== 3 ||
        !agent.sources.every(
          (source) =>
            source &&
            text(source.id) &&
            source.input &&
            typeof source.input === 'object' &&
            !Array.isArray(source.input),
        ) ||
        new Set(agent.sources.map((source) => source.id)).size !== 3
      )
        throw new Error('Three distinct real REST sources with object inputs required');
    }
  }
  return profile;
}

export function thresholdsFor(profile) {
  if (profile.mode === 'socket')
    return {
      checks: ['rate==1'],
      runtime_socket_connected: [`count==${profile.count}`],
      runtime_socket_unexpected_close: ['count==0'],
      runtime_socket_held_seconds: [`min>=${profile.duration - 1}`],
      iterations: [`count==${profile.count}`],
    };
  return {
    http_req_failed: ['rate<0.0005'],
    checks: ['rate==1'],
    verbis_agent_api_open_ms: ['p(95)<1000'],
    verbis_interactions_completed: [`count==${profile.count * profile.rounds}`],
    verbis_pages_visited: [`count==${profile.count * profile.rounds * 5}`],
    verbis_web_services_called: [`count==${profile.count * profile.rounds * 3}`],
    iterations: [`count==${profile.count * profile.rounds}`],
  };
}
export function summarize(profile, data) {
  const metrics = data.metrics || {};
  const value = (name, statistic) => {
    const measured = metrics[name]?.values?.[statistic];
    return typeof measured === 'number' && Number.isFinite(measured) ? measured : null;
  };
  const expected =
    profile.mode === 'socket'
      ? { connected: profile.count, heldSeconds: profile.duration }
      : {
          interactions: profile.count * profile.rounds,
          pages: profile.count * profile.rounds * 5,
          restCalls: profile.count * profile.rounds * 3,
        };
  const observed =
    profile.mode === 'socket'
      ? {
          connected: value('runtime_socket_connected', 'count'),
          unexpectedCloses: value('runtime_socket_unexpected_close', 'count'),
          minimumHeldSeconds: value('runtime_socket_held_seconds', 'min'),
        }
      : {
          interactions: value('verbis_interactions_completed', 'count'),
          pages: value('verbis_pages_visited', 'count'),
          restCalls: value('verbis_web_services_called', 'count'),
        };
  const thresholds = thresholdsFor(profile);
  const thresholdResults = Object.fromEntries(
    Object.entries(thresholds).map(([name, expressions]) => [
      name,
      expressions.every((expression) => metrics[name]?.thresholds?.[expression]?.ok === true),
    ]),
  );
  const countsMatch =
    profile.mode === 'socket'
      ? observed.connected === expected.connected &&
        observed.unexpectedCloses === 0 &&
        observed.minimumHeldSeconds >= expected.heldSeconds - 1 &&
        observed.minimumHeldSeconds !== null
      : Object.keys(expected).every((key) => observed[key] === expected[key]);
  return {
    measuredAt: new Date().toISOString(),
    profile: {
      mode: profile.mode,
      requestedAgents: profile.count,
      rounds: profile.mode === 'interaction' ? profile.rounds : null,
      slotSeconds: profile.mode === 'interaction' ? 180 : null,
      soakSeconds: profile.mode === 'socket' ? profile.duration : null,
    },
    expected,
    observed,
    thresholdResults,
    accepted: countsMatch && Object.values(thresholdResults).every((passed) => passed),
    scope:
      profile.mode === 'socket'
        ? 'socket resume/heartbeat only; not REST, reconnect, HA or enterprise acceptance'
        : 'vendor launch/API outcome acceptance only; not connector ACK or rendered browser performance',
    testRunDurationMs:
      typeof data.state?.testRunDurationMs === 'number' ? data.state.testRunDurationMs : null,
    metrics,
  };
}
