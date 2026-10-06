import { expect, it } from 'vitest';

import { recommendVariant } from './recommendations.js';

const arm = (key: string, sessions: number, completed: number, unresolved = 0) => ({
  key,
  sessions,
  completed,
  unresolved,
});
it('recommends the significantly better arm', () => {
  const r = recommendVariant([arm('a', 1000, 500), arm('b', 1000, 700)]);
  expect(r).toMatchObject({ recommended: 'b', reason: 'ok' });
  expect(recommendVariant([arm('a', 1000, 700), arm('b', 1000, 500)]).recommended).toBe('a');
});
it('gives no recommendation for small, lossy or non-significant cohorts', () => {
  expect(recommendVariant([arm('a', 10, 1), arm('b', 10, 9)])).toMatchObject({
    recommended: null,
    reason: 'insufficient-sample',
  });
  expect(recommendVariant([arm('a', 1000, 500, 100), arm('b', 1000, 700)])).toMatchObject({
    recommended: null,
    reason: 'data-loss',
  });
  expect(recommendVariant([arm('a', 1000, 500), arm('b', 1000, 505)])).toMatchObject({
    recommended: null,
    reason: 'not-significant',
  });
  expect(recommendVariant([arm('a', 100, 5)]).reason).toBe('needs-two-cohorts');
  expect(recommendVariant([arm('a', 100, 500), arm('b', 100, 5)]).reason).toBe('data-loss');
});
