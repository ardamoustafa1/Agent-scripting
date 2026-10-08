import { expect, it } from 'vitest';

import { ApiError, shouldRetryQuery } from './client.js';

it('never retries a client error but retries a flaky server once', () => {
  for (const status of [400, 401, 403, 404, 409, 412, 422, 429])
    expect(shouldRetryQuery(0, new ApiError(status, 'X')), String(status)).toBe(false);
  expect(shouldRetryQuery(0, new ApiError(503, 'X'))).toBe(true);
  expect(shouldRetryQuery(1, new ApiError(503, 'X'))).toBe(false);
  expect(shouldRetryQuery(0, new TypeError('network'))).toBe(true);
});
