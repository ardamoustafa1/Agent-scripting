import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Sheet } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Sheet' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Sheet">
        <ComponentDemo component="Sheet" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Sheet', component: Sheet, tags: ['autodocs'] } satisfies Meta<
  typeof Sheet
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
