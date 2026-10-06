import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_PERMISSIONS } from '../authz/permissions.js';

import { DeadLettersController } from './dead-letters.controller.js';
import { ReplayRequestSchema } from './dead-letters.service.js';

import type { DeadLettersService } from './dead-letters.service.js';

describe('DeadLettersController', () => {
  it('requires read:Connector to view and manage:Connector to replay', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS,
        Reflect.get(DeadLettersController.prototype, 'stats') as object,
      ),
    ).toEqual(['read:Connector']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS,
        Reflect.get(DeadLettersController.prototype, 'replay') as object,
      ),
    ).toEqual(['manage:Connector']);
  });
  it('validates the replay body strictly with a bounded default limit', () => {
    expect(ReplayRequestSchema.parse({})).toEqual({ limit: 100 });
    for (const bad of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { tenantId: 'x' }])
      expect(ReplayRequestSchema.safeParse(bad).success).toBe(false);
  });
  it('delegates to the service', async () => {
    const replay = vi.fn().mockResolvedValue({ replayed: 2 });
    const c = new DeadLettersController({ replay } as unknown as DeadLettersService);
    await expect(c.replay({ limit: 5 })).resolves.toEqual({ replayed: 2 });
    expect(replay).toHaveBeenCalledWith(5);
  });
});
