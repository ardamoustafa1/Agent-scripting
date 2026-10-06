import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Input } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Input' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Input">
        <ComponentDemo component="Input" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Input', component: Input, tags: ['autodocs'] } satisfies Meta<
  typeof Input
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
