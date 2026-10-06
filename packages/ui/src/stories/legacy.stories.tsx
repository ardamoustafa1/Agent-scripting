import { type Meta, type StoryObj } from '@storybook/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppShell, SelectField, StatusBadge, Button, THEMES, type Theme } from '../index.js';

export default { title: 'Compatibility/Existing API', tags: ['autodocs'] } satisfies Meta;
function Demo() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>('light');
  return (
    <AppShell
      productName={t('common.productName')}
      appName={t('ui.sample.title')}
      skipLinkLabel={t('common.skipToContent')}
      actions={
        <SelectField
          label={t('common.theme.label')}
          value={theme}
          onChange={setTheme}
          options={THEMES.map((value) => ({ value, label: t(`common.theme.${value}`) }))}
        />
      }
    >
      <div className="vb-card vb-demo-stack">
        <StatusBadge
          status="up"
          label={t('common.health.label')}
          statusText={t('common.health.up')}
        />
        <Button>{t('ui.sample.action')}</Button>
      </div>
    </AppShell>
  );
}
export const AppShellAndSelectField: StoryObj = { render: () => <Demo /> };
