import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Slider } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Slider' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Slider">
        <ComponentDemo component="Slider" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Slider', component: Slider, tags: ['autodocs'] } satisfies Meta<
  typeof Slider
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
