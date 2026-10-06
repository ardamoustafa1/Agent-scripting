import { type StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/stories/**/*.stories.tsx'],
  // Playwright owns the axe run during E2E; the addon otherwise starts a second
  // scan in the same frame. Keep it available in interactive Storybook sessions.
  addons: [
    '@storybook/addon-essentials',
    ...(process.env['UI_E2E_AXE'] === '1' ? [] : ['@storybook/addon-a11y']),
    '@storybook/addon-themes',
  ],
  framework: { name: '@storybook/react-vite', options: {} },
  docs: { autodocs: 'tag' },
  core: { disableTelemetry: true },
};
export default config;
