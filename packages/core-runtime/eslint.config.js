import { createConfig } from '@verbis/config-eslint';

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  kind: 'react',
  restrictedImportPatterns: [
    {
      group: ['@verbis/components', '@verbis/sdk-component'],
      message: 'core-runtime must not depend on higher layers (CLAUDE.md §3).',
    },
  ],
});
