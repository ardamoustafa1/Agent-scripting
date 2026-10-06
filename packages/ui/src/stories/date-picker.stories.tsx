import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { DatePicker } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'DatePicker' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="DatePicker">
        <ComponentDemo component="DatePicker" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/DatePicker', component: DatePicker, tags: ['autodocs'] } satisfies Meta<
  typeof DatePicker
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
