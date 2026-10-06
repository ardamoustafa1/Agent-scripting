import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'IconButton' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="IconButton">
        <ComponentDemo component="IconButton" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/IconButton', component: IconButton, tags: ['autodocs'] } satisfies Meta<
  typeof IconButton
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
