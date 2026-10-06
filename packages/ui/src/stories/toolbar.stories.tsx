import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Toolbar } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Toolbar' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Toolbar">
        <ComponentDemo component="Toolbar" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Toolbar', component: Toolbar, tags: ['autodocs'] } satisfies Meta<
  typeof Toolbar
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
