import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Textarea } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Textarea' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Textarea">
        <ComponentDemo component="Textarea" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Textarea', component: Textarea, tags: ['autodocs'] } satisfies Meta<
  typeof Textarea
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
