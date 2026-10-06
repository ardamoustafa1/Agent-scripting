import {
  Controller,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { type FastifyReply, type FastifyRequest } from 'fastify';

import { SIGNATURE_HEADER } from '@verbis/sdk-connector';

import { GenericWebhookConnector } from '../connectors/generic-webhook/generic-webhook.connector.js';
import { ConnectorSupervisor } from '../runtime/connector-supervisor.js';

import { toHttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Generic Webhook ingress. Unauthenticated at the HTTP layer by design: the HMAC over the raw
 * body (per-connector secret from the vault) authenticates the sender. Unknown connectors and
 * bad signatures look alike to the caller (404 vs 401 only after the connector exists).
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(ConnectorSupervisor) private readonly supervisor: ConnectorSupervisor) {}

  @Post(':connectorId')
  @HttpCode(202)
  @Header('cache-control', 'no-store')
  async receive(
    @Param('connectorId') connectorId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const instance = ID.test(connectorId) ? this.supervisor.byId(connectorId) : undefined;
    if (!(instance?.connector instanceof GenericWebhookConnector) || instance.state !== 'running')
      throw new NotFoundException();
    const signature = request.headers[SIGNATURE_HEADER];
    try {
      const accepted = await instance.connector.handleWebhook(
        request.rawBody ?? Buffer.alloc(0),
        typeof signature === 'string' ? signature : undefined,
      );
      return { accepted };
    } catch (error) {
      const http = toHttpError(error);
      if (http.getStatus() === 503) void reply.header('retry-after', '5');
      throw http;
    }
  }
}
