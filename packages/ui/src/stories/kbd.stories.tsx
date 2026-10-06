import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Kbd } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Kbd' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Kbd">
        <ComponentDemo component="Kbd" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Kbd', component: Kbd, tags: ['autodocs'] } satisfies Meta<typeof Kbd>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
