import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { UiProvider, Button, Badge, BrandLogo, type Theme } from '../index.js';

function Demo({ primaryColor, theme }: { primaryColor: string; theme: Theme }) {
  const { t, i18n } = useTranslation();
  return (
    <UiProvider i18n={i18n} theme={theme} brand={{ name: 'Verbis', primaryColor }}>
      <div className="vb-demo-stage vb-demo-stack">
        <BrandLogo brand={{ name: 'Verbis', primaryColor }} />
        <Badge tone="success">{t('ui.sample.badge')}</Badge>
        <Button>{t('ui.sample.action')}</Button>
      </div>
    </UiProvider>
  );
}
const meta = {
  title: 'Foundations/Branding',
  component: Demo,
  tags: ['autodocs'],
  argTypes: {
    primaryColor: { control: 'text' },
    theme: { control: 'select', options: ['light', 'dark', 'high-contrast'] },
  },
  args: { primaryColor: '#ffff00', theme: 'light' },
} satisfies Meta<typeof Demo>;
export default meta;
export const AccessibleBrand: StoryObj<typeof meta> = {};
