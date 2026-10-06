import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  GENESYS_CLOUD_REGIONS,
  isGenesysStreamingUrl,
  type GenesysCloudRegion,
} from '@verbis/sdk-connector';

import { GenesysCloudClient, seg } from './genesys-client.js';
import { MembersSchema } from './genesys-cloud.connector.js';
import { ConversationSchema } from './mapper.js';
import { ChannelSchema } from './notifications.js';

/**
 * Opt-in contract test against a real Genesys Cloud sandbox org (docs/connectors/genesys-cloud.md).
 * It validates the live Platform API responses with the SAME zod schemas the connector uses, so a
 * drift between the vendor API and our assumptions fails here instead of in production.
 * Read-only apart from one notification channel, which expires on its own (24 h).
 *
 * Enable with GENESYS_SANDBOX=1 plus the variables below (client credentials of a synthetic,
 * least-privilege OAuth client; never a production org). Credentials are never logged.
 */
const enabled = process.env['GENESYS_SANDBOX'] === '1';
const required = (key: string): string => {
  const value = process.env[key];
  if (enabled && (value === undefined || value === ''))
    throw new Error(`${key} is required when GENESYS_SANDBOX=1`);
  return value ?? '';
};
const region = required('GENESYS_SANDBOX_REGION');
const clientId = required('GENESYS_SANDBOX_CLIENT_ID');
const clientSecret = required('GENESYS_SANDBOX_CLIENT_SECRET');
const userId = required('GENESYS_SANDBOX_USER_ID');
const queueId = process.env['GENESYS_SANDBOX_QUEUE_ID'] ?? '';
const conversationId = process.env['GENESYS_SANDBOX_CONVERSATION_ID'] ?? '';

const OrganizationSchema = z.looseObject({ id: z.string().min(1) });
const HEARTBEAT_WAIT_MS = 45_000;

describe.skipIf(!enabled)('Genesys Cloud sandbox contract', () => {
  if (enabled && !(region in GENESYS_CLOUD_REGIONS))
    throw new Error(
      `GENESYS_SANDBOX_REGION must be one of ${Object.keys(GENESYS_CLOUD_REGIONS).join(', ')}`,
    );
  const client = new GenesysCloudClient(region as GenesysCloudRegion, () =>
    Promise.resolve({ clientId, clientSecret }),
  );

  it('authenticates with client credentials and reads the organization', async () => {
    const org = await client.request('GET', '/api/v2/organizations/me', OrganizationSchema);
    expect(org.id).not.toBe('');
  });

  it('creates a notification channel, subscribes and receives a heartbeat', async () => {
    const channel = await client.request('POST', '/api/v2/notifications/channels', ChannelSchema, {
      idempotent: false,
    });
    expect(isGenesysStreamingUrl(region as GenesysCloudRegion, channel.connectUri)).toBe(true);
    await client.request(
      'PUT',
      `/api/v2/notifications/channels/${seg(channel.id)}/subscriptions`,
      z.unknown(),
      { body: [{ id: `v2.users.${userId}.conversations` }] },
    );
    const frame = await new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocket(channel.connectUri);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('no channel.metadata heartbeat within 45 s'));
      }, HEARTBEAT_WAIT_MS);
      socket.addEventListener('message', (event) => {
        const parsed = z
          .looseObject({ topicName: z.string() })
          .safeParse(JSON.parse(String(event.data)));
        if (parsed.success && parsed.data.topicName === 'channel.metadata') {
          clearTimeout(timer);
          socket.close(1000, 'contract test done');
          resolve(parsed.data);
        }
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('notification socket failed'));
      });
    });
    expect(frame).toMatchObject({ topicName: 'channel.metadata' });
  }, 60_000);

  it.skipIf(queueId === '')('reads queue members with the connector schema', async () => {
    const members = await client.request(
      'GET',
      `/api/v2/routing/queues/${seg(queueId)}/members?pageSize=25&pageNumber=1`,
      MembersSchema,
    );
    expect(Array.isArray(members.entities)).toBe(true);
  });

  it.skipIf(conversationId === '')('reads a conversation with the connector schema', async () => {
    const conversation = await client.request(
      'GET',
      `/api/v2/conversations/${seg(conversationId)}`,
      ConversationSchema,
    );
    expect(conversation.id).toBe(conversationId);
  });
});
