import type { Migration } from './types.js';
/** Existing flow.start pointers remain valid; explicit Start nodes are optional. */
export const v1_0_0_to_v1_1_0: Migration = {
  from: '1.0.0',
  to: '1.1.0',
  description: 'Flow start/transfer nodes, end dispositions and designer annotations',
  up: (document) => ({ ...document, schemaVersion: '1.1.0' }),
};
