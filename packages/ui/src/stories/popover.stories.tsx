import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Popover } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Popover' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Popover">
        <ComponentDemo component="Popover" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Popover', component: Popover, tags: ['autodocs'] } satisfies Meta<
  typeof Popover
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
