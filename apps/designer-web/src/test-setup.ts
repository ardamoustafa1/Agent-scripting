import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: vi.fn(),
    configurable: true,
  });
});
