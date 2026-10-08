import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { setSuggestionMarks, useSuggestionMark } from './suggest-marks.js';

function Probe({ id }: { id: string }) {
  return <p>{useSuggestionMark(id) ? `${id} marked` : `${id} plain`}</p>;
}
afterEach(() => {
  act(() => {
    setSuggestionMarks([]);
  });
});

it('marks exactly the given nodes, updates readers and clears again', () => {
  render(
    <>
      <Probe id="a" />
      <Probe id="b" />
    </>,
  );
  expect(screen.getByText('a plain')).toBeTruthy();
  act(() => {
    setSuggestionMarks(['a']);
  });
  expect(screen.getByText('a marked')).toBeTruthy();
  expect(screen.getByText('b plain')).toBeTruthy();
  // Setting the same ids again is a no-op; a different set replaces it.
  act(() => {
    setSuggestionMarks(['a']);
    setSuggestionMarks(['b']);
  });
  expect(screen.getByText('a plain')).toBeTruthy();
  expect(screen.getByText('b marked')).toBeTruthy();
  act(() => {
    setSuggestionMarks([]);
  });
  expect(screen.getByText('b plain')).toBeTruthy();
});
