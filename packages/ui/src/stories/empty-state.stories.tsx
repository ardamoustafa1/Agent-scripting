import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'EmptyState' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="EmptyState">
        <ComponentDemo component="EmptyState" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/EmptyState', component: EmptyState, tags: ['autodocs'] } satisfies Meta<
  typeof EmptyState
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
