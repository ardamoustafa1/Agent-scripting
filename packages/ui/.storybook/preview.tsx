import { type Preview } from '@storybook/react';
import { useEffect, type ReactNode } from 'react';

import { createI18n } from '@verbis/i18n';

import { UiProvider, applyTheme, type Theme } from '../src/index.js';
import '../src/fonts.css';
import '../src/tokens.css';
import '../src/stories/stories.css';

const locales = { tr: await createI18n('tr'), en: await createI18n('en') };
function Surface({
  children,
  theme,
  locale,
  direction,
}: {
  children: ReactNode;
  theme: Theme;
  locale: 'tr' | 'en';
  direction: 'ltr' | 'rtl';
}) {
  useEffect(() => {
    applyTheme(theme, document.documentElement);
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [theme, locale, direction]);
  return (
    <UiProvider i18n={locales[locale]} theme={theme} direction={direction}>
      <main className="vb-story-surface">{children}</main>
    </UiProvider>
  );
}
const preview: Preview = {
  initialGlobals: { theme: 'light', locale: 'tr', direction: 'ltr' },
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        icon: 'paintbrush',
        items: ['light', 'dark', 'high-contrast'],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Language',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'tr', title: 'Türkçe' },
          { value: 'en', title: 'English' },
        ],
        dynamicTitle: true,
      },
    },
    direction: {
      description: 'Direction',
      toolbar: { icon: 'transfer', items: ['ltr', 'rtl'], dynamicTitle: true },
    },
  },
  parameters: {
    layout: 'fullscreen',
    a11y: { config: { rules: [] } },
    controls: { expanded: true },
  },
  decorators: [
    (Story, context) => {
      const globals: Record<string, unknown> = context.globals;
      const theme =
        globals['theme'] === 'dark'
          ? 'dark'
          : globals['theme'] === 'high-contrast'
            ? 'high-contrast'
            : 'light';
      const locale = globals['locale'] === 'en' ? 'en' : 'tr';
      const direction = globals['direction'] === 'rtl' ? 'rtl' : 'ltr';
      return (
        <Surface theme={theme} locale={locale} direction={direction}>
          <Story />
        </Surface>
      );
    },
  ],
};
export default preview;
