import { HttpException, HttpStatus } from '@nestjs/common';

import {
  BackpressureError,
  CommandNotSupportedError,
  ConnectorError,
  PayloadRejectedError,
} from '@verbis/sdk-connector';
import { problemForCode } from '@verbis/shared-types';

import { WebhookSignatureError } from '../connectors/generic-webhook/generic-webhook.connector.js';

/** Connector errors → HTTP (rendered as RFC 7807 by the problem filter). Details stay generic. */
export function toHttpError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof WebhookSignatureError)
    return new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
  if (error instanceof BackpressureError)
    return new HttpException('Busy, retry later', HttpStatus.SERVICE_UNAVAILABLE);
  if (error instanceof PayloadRejectedError)
    return new HttpException('Payload rejected', HttpStatus.UNPROCESSABLE_ENTITY);
  if (error instanceof CommandNotSupportedError)
    return new HttpException('Command not supported', HttpStatus.UNPROCESSABLE_ENTITY);
  if (error instanceof ConnectorError && error.code === 'agent_at_capacity')
    return new HttpException(
      problemForCode('VERBIS_CONNECTOR_CONCURRENCY_LIMIT', {
        detail: 'End an existing interaction on this channel before starting another.',
      }),
      HttpStatus.CONFLICT,
    );
  if (error instanceof ConnectorError)
    return error.retryable
      ? new HttpException('Connector unavailable', HttpStatus.SERVICE_UNAVAILABLE)
      : new HttpException(error.code, HttpStatus.UNPROCESSABLE_ENTITY);
  return new HttpException('Internal error', HttpStatus.INTERNAL_SERVER_ERROR);
}
