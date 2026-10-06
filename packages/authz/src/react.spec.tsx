// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createAbility } from './ability.js';
import { AbilityProvider, Can } from './react.js';

afterEach(() => {
  cleanup();
});

describe('<Can>', () => {
  it('hides children the ability does not allow and re-renders on update', () => {
    const ability = createAbility([{ action: 'read', subject: 'Script' }]);
    render(
      <AbilityProvider ability={ability}>
        <Can I="read" a="Script">
          <span>read</span>
        </Can>
        <Can I="publish" a="Script">
          <span>publish</span>
        </Can>
        <Can I="publish" a="Script" not>
          <span>no-publish</span>
        </Can>
      </AbilityProvider>,
    );
    expect(screen.queryByText('read')).not.toBeNull();
    expect(screen.queryByText('publish')).toBeNull();
    expect(screen.queryByText('no-publish')).not.toBeNull();

    act(() => {
      ability.update([{ action: 'manage', subject: 'Script' }]);
    });
    expect(screen.queryByText('publish')).not.toBeNull();
    expect(screen.queryByText('no-publish')).toBeNull();
  });

  it('denies everything without a provider', () => {
    render(
      <Can I="read" a="Script">
        <span>read</span>
      </Can>,
    );
    expect(screen.queryByText('read')).toBeNull();
  });
});
