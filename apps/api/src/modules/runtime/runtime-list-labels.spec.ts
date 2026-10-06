import { expect, it, vi } from 'vitest';

import { SessionListQuerySchema } from './runtime.dto.js';
import { RuntimeService } from './runtime.service.js';

import type { RuntimeEngineService } from './runtime-engine.service.js';
import type { RuntimeRepository, SessionRow } from './runtime.repository.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';

it.each([true, false])(
  'returns lightweight labels with customer reveal=%s and no runtime document hydration',
  async (reveal) => {
    const row = {
      id: 'session',
      userId: 'agent',
      teamId: null,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      endedAt: null,
      interaction: {
        id: 'interaction',
        channelType: 'chat',
        queue: null,
        attributes: { sealed: 'test' },
      },
    } as unknown as SessionRow;
    const list = vi.fn().mockResolvedValue([row]);
    const labels = vi.fn().mockReturnValue({ 'channel.chat.customerName': 'Synthetic customer' });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new RuntimeService(
      { can: (action: string) => action === 'read' || reveal } as unknown as AuthzService,
      { current: () => ({}), tenantId: () => 'tenant' } as unknown as TenantDb,
      { listSessions: list } as unknown as RuntimeRepository,
      { interactionLabelContext: labels } as unknown as RuntimeEngineService,
      audit as unknown as AuditService,
    );
    const page = await service.listSessions(SessionListQuerySchema.parse({}));
    expect(page.data[0]?.desktopLabel).toEqual({
      channel: 'chat',
      customerName: reveal ? 'Synthetic customer' : null,
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(labels).toHaveBeenCalledTimes(reveal ? 1 : 0);
    expect(audit.record).toHaveBeenCalledTimes(reveal ? 1 : 0);
  },
);
