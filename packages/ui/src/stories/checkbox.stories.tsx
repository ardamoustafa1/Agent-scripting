import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Checkbox } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Checkbox' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Checkbox">
        <ComponentDemo component="Checkbox" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Checkbox', component: Checkbox, tags: ['autodocs'] } satisfies Meta<
  typeof Checkbox
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
