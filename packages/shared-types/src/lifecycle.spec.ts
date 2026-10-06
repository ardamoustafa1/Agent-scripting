import { describe, expect, it } from 'vitest';

import {
  CommentInputSchema,
  ReleaseScheduleSchema,
  PackageImportRequestSchema,
  ResolveThreadSchema,
  RollbackSchema,
} from './lifecycle.js';

const id = '01928f3a-0000-7000-8000-000000000001';
describe('authoring boundary contracts', () => {
  it('bounds comment size and mention IDs and rejects empty text', () => {
    expect(CommentInputSchema.safeParse({ nodeId: 'script', text: ' ' }).success).toBe(false);
    expect(CommentInputSchema.safeParse({ nodeId: 'script', text: 'x'.repeat(4001) }).success).toBe(
      false,
    );
    expect(
      CommentInputSchema.safeParse({
        nodeId: 'script',
        text: 'Safe',
        mentions: ['other-tenant-name'],
      }).success,
    ).toBe(false);
    expect(
      CommentInputSchema.parse({ nodeId: 'a', text: ' Synthetic ', mentions: [id] }).text,
    ).toBe('Synthetic');
  });
  it('requires UTC/offset scheduling and an optimistic release head for rollback', () => {
    expect(ReleaseScheduleSchema.safeParse({ at: '2026-10-02T11:30' }).success).toBe(false);
    expect(RollbackSchema.safeParse({ targetNumber: 1 }).success).toBe(false);
    expect(ResolveThreadSchema.safeParse({ resolved: true, version: 0 }).success).toBe(false);
  });
  it('accepts only secret references in the import mapping envelope', () => {
    expect(
      PackageImportRequestSchema.safeParse({ package: {}, secretMappings: { [id]: 'plaintext' } })
        .success,
    ).toBe(false);
    expect(
      PackageImportRequestSchema.safeParse({
        package: {},
        integrationMappings: { source: { key: '../evil', version: 1 } },
      }).success,
    ).toBe(false);
    expect(
      PackageImportRequestSchema.parse({ package: {}, secretMappings: { [id]: id } })
        .secretMappings[id],
    ).toBe(id);
  });
});
