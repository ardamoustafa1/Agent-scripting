import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { BrandLogo } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'BrandLogo' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="BrandLogo">
        <ComponentDemo component="BrandLogo" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/BrandLogo', component: BrandLogo, tags: ['autodocs'] } satisfies Meta<
  typeof BrandLogo
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
