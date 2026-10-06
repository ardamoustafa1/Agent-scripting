import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Accordion } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Accordion' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Accordion">
        <ComponentDemo component="Accordion" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Accordion', component: Accordion, tags: ['autodocs'] } satisfies Meta<
  typeof Accordion
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
