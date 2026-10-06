import { claimValue } from '../../identity/idp/role-mapping.js';

import { GatewayCommandSchema } from './gateway-contracts.js';
import { IntegrationError } from './transport.js';

import type { Call, DataSource, WireRequest, WireResponse } from './contracts.js';
import type { PrivateEgressService } from '../private-egress.service.js';

export type GatewayDispatch = (
  tenant: string,
  source: DataSource,
  call: Call,
  wire: WireRequest,
  origins: readonly string[],
  signal: AbortSignal,
) => Promise<WireResponse>;
export function gatewayDispatch(gateway: PrivateEgressService): GatewayDispatch {
  return (tenant, source, call, wire, origins, signal) => {
    const config = source.definition.privateGateway;
    if (
      !config ||
      source.definition.auth.type !== 'none' ||
      Object.values(source.definition.profiles).some(
        (profile) => profile !== undefined && profile.auth.type !== 'none',
      )
    )
      throw new IntegrationError('GATEWAY_CONFIG_REQUIRED');
    if (
      source.protocol !== 'sql' &&
      (!source.policy.allowedOrigins.includes(wire.url.origin) ||
        !origins.includes(wire.url.origin) ||
        wire.url.username ||
        wire.url.password ||
        wire.url.hash ||
        !(
          wire.url.protocol === 'https:' ||
          (wire.url.protocol === 'http:' && source.policy.allowHttp)
        ))
    )
      throw new IntegrationError('EGRESS_DENIED');
    const sql = source.definition.sql;
    const command =
      source.protocol === 'sql'
        ? sql
          ? GatewayCommandSchema.parse({
              kind: 'sql',
              queryKey: sql.queryKey,
              parameters: sql.parameters.map((path) =>
                claimValue(call.input as Record<string, unknown>, path),
              ),
            })
          : undefined
        : GatewayCommandSchema.parse({
            kind: 'http',
            url: wire.url.href,
            method: wire.method,
            headers: wire.headers,
            ...(wire.body === undefined ? {} : { body: wire.body }),
          });
    if (!command) throw new IntegrationError('SQL_CONFIG_REQUIRED');
    return gateway.dispatch(
      tenant,
      config.clientId,
      config.target,
      command,
      source.policy.timeoutMs,
      source.policy.maxResponseBytes,
      signal,
    );
  };
}
