import { createConfig } from '@verbis/config-eslint';

export default [
  { ignores: ['template/**'] },
  ...createConfig({ tsconfigRootDir: import.meta.dirname, kind: 'react' }),
];
