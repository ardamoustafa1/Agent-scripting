import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Progress } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Progress' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Progress">
        <ComponentDemo component="Progress" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Progress', component: Progress, tags: ['autodocs'] } satisfies Meta<
  typeof Progress
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
