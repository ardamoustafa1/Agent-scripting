import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Switch } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Switch' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Switch">
        <ComponentDemo component="Switch" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Switch', component: Switch, tags: ['autodocs'] } satisfies Meta<
  typeof Switch
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
