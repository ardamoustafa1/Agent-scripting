import { render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommandRegistryProvider,
  readRecentCommands,
  useCommandRegistry,
  useContributeCommands,
  writeRecentCommand,
  type CommandRegistry,
} from './commands.js';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('command registry', () => {
  let registry: CommandRegistry | undefined;
  function Contributor({ label }: { label: string }) {
    useContributeCommands('page', (query) => [
      { id: 'x', label: `${label}:${query}`, onSelect: vi.fn() },
    ]);
    return null;
  }
  function Host({ show, label }: { show: boolean; label: string }) {
    const created = useCommandRegistry();
    const [stable] = useState(created);
    registry = stable;
    return (
      <CommandRegistryProvider registry={stable}>
        {show && <Contributor label={label} />}
      </CommandRegistryProvider>
    );
  }

  it('reads contributions lazily with the latest render and removes them on unmount', () => {
    const { rerender } = render(<Host show label="first" />);
    expect(
      registry
        ?.sources()
        .flatMap((source) => source('q'))
        .map((i) => i.label),
    ).toEqual(['first:q']);
    rerender(<Host show label="second" />);
    expect(
      registry
        ?.sources()
        .flatMap((source) => source(''))
        .map((i) => i.label),
    ).toEqual(['second:']);
    rerender(<Host show={false} label="second" />);
    expect(registry?.sources()).toEqual([]);
  });

  it('is a no-op outside a provider', () => {
    expect(() => render(<Contributor label="alone" />)).not.toThrow();
  });
});

describe('recent commands', () => {
  it('keeps the five most recent unique ids, newest first', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) writeRecentCommand('key', id);
    expect(readRecentCommands('key')).toEqual(['b', 'f', 'e', 'd', 'c']);
  });

  it('ignores corrupt or unavailable storage', () => {
    localStorage.setItem('key', '{"not":"a list"}');
    expect(readRecentCommands('key')).toEqual([]);
    localStorage.setItem('key', 'not json');
    expect(readRecentCommands('key')).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(writeRecentCommand('key', 'a')).toEqual(['a']);
  });
});
