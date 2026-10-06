import { expect, it } from 'vitest';

import {
  ConnectorError,
  PayloadRejectedError,
  UnknownInteractionError,
  isRetryable,
} from './errors.js';

it('retries transient and unexpected failures but never retries permanent connector rejection', () => {
  expect(isRetryable(new ConnectorError('synthetic outage', 'upstream', true))).toBe(true);
  expect(isRetryable(new Error('unexpected'))).toBe(true);
  expect(isRetryable(null)).toBe(true);
  for (const error of [
    new PayloadRejectedError('malformed event'),
    new UnknownInteractionError(),
    new ConnectorError('denied', 'permission', false),
  ]) {
    expect(isRetryable(error)).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).not.toBe('Error');
  }
});
