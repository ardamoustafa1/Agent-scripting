import { expect, it } from 'vitest';

import { marketplaceLaunchUrl } from './marketplace-launch.js';

it('opens only the fixed launch route with an optional opaque handle', () => {
  expect(marketplaceLaunchUrl('https://agent.example.test', 'a'.repeat(43))).toBe(
    `https://agent.example.test/launch#code=${'a'.repeat(43)}`,
  );
  expect(marketplaceLaunchUrl('https://agent.example.test')).toBe(
    'https://agent.example.test/launch',
  );
  for (const origin of [
    'http://agent.example.test',
    'https://user:pass@agent.example.test',
    'https://agent.example.test/?scriptId=1',
    'https://agent.example.test/path',
    'https://agent.example.test/#bad',
  ])
    expect(() => marketplaceLaunchUrl(origin)).toThrow();
  expect(() => marketplaceLaunchUrl('https://agent.example.test', 'campaignId=1')).toThrow();
});
