import { createConfig } from '@verbis/config-eslint';

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  kind: 'react',
});
