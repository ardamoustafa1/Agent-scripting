import { describe, expect, it } from 'vitest';

import { NodeIdSchema } from './ids.js';

describe('NodeIdSchema', () => {
  it.each(['btn-submit', 'box', 'page-2-header'])('accepts %s', (id) => {
    expect(NodeIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(['', 'Btn', 'btn_submit', '-btn', 'btn-', '1btn', 'a'.repeat(65)])('rejects %j', (id) => {
    expect(NodeIdSchema.safeParse(id).success).toBe(false);
  });
});
