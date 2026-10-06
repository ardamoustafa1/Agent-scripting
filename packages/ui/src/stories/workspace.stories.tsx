import { type Meta, type StoryObj } from '@storybook/react';

import { WorkspaceDemo } from './demos.js';

export default {
  title: 'Foundations/Workspace',
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export const Overview: StoryObj = { render: () => <WorkspaceDemo /> };
