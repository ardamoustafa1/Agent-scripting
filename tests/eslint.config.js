import { createConfig } from '../packages/config-eslint/index.js';

export default createConfig({ tsconfigRootDir: import.meta.dirname, kind: 'node' });
