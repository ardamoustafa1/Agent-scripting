import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Select } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Select' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Select">
        <ComponentDemo component="Select" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Select', component: Select, tags: ['autodocs'] } satisfies Meta<
  typeof Select
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
