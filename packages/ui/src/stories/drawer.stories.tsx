import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Drawer } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Drawer' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Drawer">
        <ComponentDemo component="Drawer" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Drawer', component: Drawer, tags: ['autodocs'] } satisfies Meta<
  typeof Drawer
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
