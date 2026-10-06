import { HttpException } from '@nestjs/common';
import { expect, it } from 'vitest';

import {
  BackpressureError,
  CommandNotSupportedError,
  ConnectorError,
  PayloadRejectedError,
} from '@verbis/sdk-connector';

import { WebhookSignatureError } from '../connectors/generic-webhook/generic-webhook.connector.js';

import { toHttpError } from './errors.js';

it.each([
  [new WebhookSignatureError('private signature details'), 401, 'Invalid signature'],
  [new BackpressureError('private queue details'), 503, 'Busy, retry later'],
  [new PayloadRejectedError('private payload'), 422, 'Payload rejected'],
  [new CommandNotSupportedError('private command'), 422, 'Command not supported'],
  [new ConnectorError('private upstream details', 'safe_code', true), 503, 'Connector unavailable'],
  [new ConnectorError('private upstream details', 'safe_code', false), 422, 'safe_code'],
  [new Error('private failure'), 500, 'Internal error'],
  [null, 500, 'Internal error'],
])('maps connector failures to safe HTTP responses (%s)', (error, status, message) => {
  const result = toHttpError(error);
  expect(result.getStatus()).toBe(status);
  expect(result.message).toBe(message);
  expect(JSON.stringify(result.getResponse())).not.toContain('private');
});
it('preserves explicitly constructed HTTP exceptions', () => {
  const error = new HttpException('safe rejection', 409);
  expect(toHttpError(error)).toBe(error);
});
