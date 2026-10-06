import { fileURLToPath } from 'node:url';

import { createConfig } from '../../packages/config-eslint/index.js';

export default [
  ...createConfig({ tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)), kind: 'node' }),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
      },
    },
    // Integration harnesses compose applications; production app dependency rules still apply.
    rules: { 'no-restricted-imports': 'off' },
  },
];
