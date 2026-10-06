import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Radio } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Radio' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Radio">
        <ComponentDemo component="Radio" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Radio', component: Radio, tags: ['autodocs'] } satisfies Meta<
  typeof Radio
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
