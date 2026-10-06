import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { MultiSelect } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'MultiSelect' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="MultiSelect">
        <ComponentDemo component="MultiSelect" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/MultiSelect', component: MultiSelect, tags: ['autodocs'] } satisfies Meta<
  typeof MultiSelect
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
