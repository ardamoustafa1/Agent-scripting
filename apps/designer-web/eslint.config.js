import { createConfig } from '@verbis/config-eslint';

export default [
  { ignores: ['src/api/generated.ts'] },
  ...createConfig({ tsconfigRootDir: import.meta.dirname, kind: 'react' }),
  // React 18 uses no compiler; dnd-kit refs and TanStack Virtual intentionally expose mutable handles.
  {
    files: ['src/editor/{canvas,layers,inspector}.tsx'],
    rules: { 'react-hooks/refs': 'off', 'react-hooks/incompatible-library': 'off' },
  },
];
