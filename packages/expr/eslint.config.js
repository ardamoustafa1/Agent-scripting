import { createConfig } from '@verbis/config-eslint';

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  kind: 'node',
  restrictedImportPatterns: [
    {
      group: ['@verbis/core-runtime', '@verbis/components'],
      message: 'expr is a base layer (CLAUDE.md §3).',
    },
  ],
});
