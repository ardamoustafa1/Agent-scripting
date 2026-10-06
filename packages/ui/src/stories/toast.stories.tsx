import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Toast } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Toast' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Toast">
        <ComponentDemo component="Toast" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Toast', component: Toast, tags: ['autodocs'] } satisfies Meta<
  typeof Toast
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
