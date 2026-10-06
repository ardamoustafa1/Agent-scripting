import { z } from 'zod';

/** Simulator calls go through the BFF (/api → API → hub); the browser never talks to the hub. */
export const SIM_CHANNELS = [
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'social',
  'video',
  'callback',
] as const;
export type SimChannel = (typeof SIM_CHANNELS)[number];
export const SIM_ACTIONS = [
  'connect',
  'hold',
  'resume',
  'customerMessage',
  'transfer',
  'wrapup',
  'end',
] as const;
export type SimAction = (typeof SIM_ACTIONS)[number];

const ConnectorPageSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), adapterType: z.string(), config: z.unknown(), status: z.string() }),
  ),
});

export const SimInteractionSchema = z.object({
  platformInteractionId: z.string(),
  channel: z.enum(SIM_CHANNELS),
  agentPlatformUserId: z.string(),
  status: z.enum(['alerting', 'connected', 'held', 'transferred', 'wrapup', 'ended']),
  updatedAt: z.string(),
});
export type SimInteraction = z.infer<typeof SimInteractionSchema>;

export const SimStateSchema = z.object({
  interactions: z.array(SimInteractionSchema),
  commands: z.array(
    z.object({
      commandId: z.string(),
      command: z.string(),
      platformInteractionId: z.string(),
      at: z.string(),
    }),
  ),
});
export type SimState = z.infer<typeof SimStateSchema>;

export class SimulatorApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  csrfToken: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(method === 'POST'
        ? { 'content-type': 'application/json', 'x-csrf-token': csrfToken }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const problem = z
      .object({ code: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new SimulatorApiError(problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE');
  }
  return response.json().catch(() => null);
}

export async function listSimulatorConnectors(csrf: string): Promise<string[]> {
  const page = ConnectorPageSchema.parse(await call('GET', '/v1/connectors?limit=100', csrf));
  return page.data
    .filter(
      (c) =>
        c.adapterType === 'generic' &&
        c.status === 'active' &&
        (c.config as { kind?: unknown } | null)?.kind === 'simulator',
    )
    .map((c) => c.id);
}

export async function simulatorState(connectorId: string, csrf: string): Promise<SimState> {
  return SimStateSchema.parse(await call('GET', `/v1/simulator/connectors/${connectorId}`, csrf));
}

export interface NewSimulation {
  channel: SimChannel;
  agentPlatformUserId: string;
  agentEmail?: string;
  customerName?: string;
  subject?: string;
  message?: string;
  autoConnect: boolean;
}

export async function simulate(
  connectorId: string,
  input: NewSimulation,
  csrf: string,
): Promise<void> {
  await call('POST', `/v1/simulator/connectors/${connectorId}/interactions`, csrf, input);
}

export async function simulateAction(
  connectorId: string,
  platformInteractionId: string,
  input: { action: SimAction; message?: string; transferToPlatformUserId?: string },
  csrf: string,
): Promise<void> {
  await call(
    'POST',
    `/v1/simulator/connectors/${connectorId}/interactions/${platformInteractionId}/actions`,
    csrf,
    input,
  );
}
