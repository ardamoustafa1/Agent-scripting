import { ComponentExample } from '../test-fixtures.js';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/ActionButton',
  component: ComponentExample,
  args: { type: 'actionButton' },
  tags: ['autodocs'],
} satisfies Meta<typeof ComponentExample>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
export const Disabled: StoryObj<typeof meta> = { args: { props: { disabled: true } } };
