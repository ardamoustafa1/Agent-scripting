import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'Badge' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="Badge">
        <ComponentDemo component="Badge" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/Badge', component: Badge, tags: ['autodocs'] } satisfies Meta<
  typeof Badge
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
