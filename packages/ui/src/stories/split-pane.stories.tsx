import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { SplitPane } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'SplitPane' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="SplitPane">
        <ComponentDemo component="SplitPane" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/SplitPane', component: SplitPane, tags: ['autodocs'] } satisfies Meta<
  typeof SplitPane
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
