import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import { loadProfile, loadSettings, summarize, thresholdsFor } from './profile.js';
const agents = new SharedArray('socket agents', () => {
  const items = JSON.parse(open(__ENV.K6_AGENT_FIXTURE)).agents;
  loadProfile(__ENV, items, 'socket'); // Validate all identities once, inside shared initialization.
  return items;
});
const profile = loadSettings(__ENV, 'socket');
const { base, apiBase, count, duration } = profile;
const connected = new Counter('runtime_socket_connected');
const unexpectedClose = new Counter('runtime_socket_unexpected_close');
const held = new Trend('runtime_socket_held_seconds');
export const options = {
  scenarios: {
    soak: {
      executor: 'per-vu-iterations',
      vus: count,
      iterations: 1,
      maxDuration: profile.maxDuration,
    },
  },
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  thresholds: thresholdsFor(profile),
};
export default function () {
  unexpectedClose.add(0);
  const agent = agents[exec.vu.idInTest - 1];
  if (!agent.sessionId) fail('Socket fixture needs a separately securely launched, active session');
  const headers = {
    Origin: base,
    Cookie: agent.cookie,
    'x-csrf-token': agent.csrf,
    'content-type': 'application/json',
  };
  const issued = http.post(
    `${apiBase}/v1/sessions/${agent.sessionId}/socket-ticket`,
    JSON.stringify({ afterSequence: 0 }),
    { headers, tags: { name: 'runtime.ticket' } },
  );
  if (!check(issued, { 'ticket granted': (res) => res.status === 201 })) fail('Ticket rejected');
  const ticket = issued.json('ticket');
  let joined = false;
  let planned = false;
  let opened = 0;
  const response = ws.connect(
    `${base.replace(/^https:/, 'wss:')}/socket.io/?EIO=4&transport=websocket`,
    { headers: { Origin: base }, tags: { name: 'runtime.socket' } },
    (socket) => {
      socket.on('message', (packet) => {
        if (packet.startsWith('0')) socket.send(`40/runtime,${JSON.stringify({ ticket })}`);
        else if (packet === '2') socket.send('3');
        else if (packet.startsWith('42/runtime,')) {
          const event = JSON.parse(packet.slice('42/runtime,'.length));
          if (event[0] === 'runtime.error') {
            unexpectedClose.add(1);
            socket.close();
          }
          if (event[0] === 'runtime.resume' && !joined) {
            joined = true;
            opened = Date.now();
            connected.add(1);
            socket.setTimeout(() => {
              planned = true;
              held.add((Date.now() - opened) / 1000);
              socket.close();
            }, duration * 1000);
          }
        }
      });
      socket.on('close', () => {
        if (!planned) unexpectedClose.add(1);
      });
      socket.on('error', () => {
        unexpectedClose.add(1);
      });
      socket.setTimeout(() => {
        if (!joined) {
          unexpectedClose.add(1);
          socket.close();
        }
      }, 10000);
    },
  );
  check(response, { 'websocket upgrade': (res) => res && res.status === 101 });
}
export function handleSummary(data) {
  return {
    [__ENV.K6_RESULTS || 'test-results/k6-socket-soak.json']: JSON.stringify(
      summarize(profile, data),
      null,
      2,
    ),
  };
}
