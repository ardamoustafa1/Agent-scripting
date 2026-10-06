import { useEffect } from 'react';

import { createI18n } from '@verbis/i18n';
import { UiProvider, applyTheme } from '@verbis/ui';

import type { Preview } from '@storybook/react';
import '@verbis/ui/fonts.css';
import '../src/styles.css';

const locales = { tr: await createI18n('tr'), en: await createI18n('en') };
const preview: Preview = {
  initialGlobals: { theme: 'light', locale: 'tr', direction: 'ltr' },
  globalTypes: {
    theme: { toolbar: { icon: 'paintbrush', items: ['light', 'dark', 'high-contrast'] } },
    locale: { toolbar: { icon: 'globe', items: ['tr', 'en'] } },
    direction: { toolbar: { icon: 'transfer', items: ['ltr', 'rtl'] } },
  },
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
  decorators: [
    (Story, context) => {
      const theme =
        context.globals['theme'] === 'dark'
          ? 'dark'
          : context.globals['theme'] === 'high-contrast'
            ? 'high-contrast'
            : 'light';
      const locale = context.globals['locale'] === 'en' ? 'en' : 'tr';
      const direction = context.globals['direction'] === 'rtl' ? 'rtl' : 'ltr';
      return (
        <Surface theme={theme} locale={locale} direction={direction}>
          <Story />
        </Surface>
      );
    },
  ],
};
function Surface({
  theme,
  locale,
  direction,
  children,
}: {
  theme: 'light' | 'dark' | 'high-contrast';
  locale: 'tr' | 'en';
  direction: 'ltr' | 'rtl';
  children: React.ReactNode;
}) {
  useEffect(() => {
    applyTheme(theme, document.documentElement);
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [theme, locale, direction]);
  return (
    <UiProvider i18n={locales[locale]} theme={theme} direction={direction}>
      <main className="vc-story">{children}</main>
    </UiProvider>
  );
}
export default preview;
