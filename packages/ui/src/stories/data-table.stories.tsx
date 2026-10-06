import { type Meta, type StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '../index.js';

import { ComponentDemo } from './demos.js';

function Demo() {
  const { t } = useTranslation();
  return (
    <div id="ui-demo">
      <header className="vb-story-heading">
        <h1>{t('ui.sample.componentTitle', { name: 'DataTable' })}</h1>
        <p>{t('ui.sample.description')}</p>
      </header>
      <section className="vb-demo-stage" aria-label="DataTable">
        <ComponentDemo component="DataTable" />
      </section>
    </div>
  );
}
const meta = { title: 'UI/DataTable', component: DataTable, tags: ['autodocs'] } satisfies Meta<
  typeof DataTable
>;
export default meta;
export const Playground: StoryObj = { render: () => <Demo /> };
