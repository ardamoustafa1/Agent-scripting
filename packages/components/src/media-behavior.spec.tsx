import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { ComponentProvider } from './environment.js';
import { MediaComponent, Signature } from './media.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function mount(type: string, props = {}, features = ['signature'], enabled = true) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, type),
    write = vi.fn(),
    emit = vi.fn().mockResolvedValue(undefined);
  const Renderer = type === 'signature' ? Signature : MediaComponent;
  const view = render(
    <UiProvider i18n={i18n}>
      <ComponentProvider
        environment={{
          mediaOrigins: ['https://assets.example.test'],
          frameOrigins: ['https://assets.example.test'],
          knowledgeOrigins: [],
          features,
          now: Date.now,
        }}
      >
        <Renderer
          {...component}
          props={{ ...component.props, ...props }}
          write={write}
          emit={emit}
          enabled={enabled}
        />
      </ComponentProvider>
    </UiProvider>,
  );
  return { runtime, write, emit, view };
}
it('renders approved image, video captions and an opaque iframe without granting ambient capabilities', () => {
  const image = mount('image', { url: 'https://assets.example.test/a.png' });
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://assets.example.test/a.png');
  expect(screen.getByRole('img').getAttribute('referrerpolicy')).toBe('no-referrer');
  image.view.unmount();
  const video = mount('video', {
    url: 'https://assets.example.test/a.mp4',
    captionsUrl: 'https://assets.example.test/a.vtt',
    poster: 'https://assets.example.test/a.png',
  });
  expect(document.querySelector('video')?.getAttribute('poster')).toBe(
    'https://assets.example.test/a.png',
  );
  expect(document.querySelector('track')?.getAttribute('src')).toBe(
    'https://assets.example.test/a.vtt',
  );
  video.view.unmount();
  mount('iframe', { url: 'https://assets.example.test/frame' });
  expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
  expect(document.querySelector('iframe')?.getAttribute('allow')).toContain("camera 'none'");
});
it.each(['timer', 'countdown'])(
  'emits %s elapsed only once and stops work when unmounted',
  async (type) => {
    vi.useFakeTimers();
    const f = mount(type, { durationSec: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(f.emit).toHaveBeenCalledExactlyOnceWith('onElapsed');
    expect(screen.getByText(i18n.t('components.elapsed')).textContent).toBe(
      i18n.t('components.elapsed'),
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(f.emit).toHaveBeenCalledOnce();
    f.view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('requires an enabled signature feature and supports typed signatures and clearing', async () => {
  const disabled = mount('signature', {}, []);
  expect(screen.getByRole('status').textContent).toBe(i18n.t('components.optionalFeature'));
  expect(screen.queryByRole('textbox')).toBeNull();
  disabled.view.unmount();
  const f = mount('signature');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic signature' } });
  expect(f.write).toHaveBeenCalledWith('value', 'Synthetic signature');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('components.clear') }));
    await Promise.resolve();
  });
  expect(f.write).toHaveBeenLastCalledWith('value', '');
  expect(f.emit).toHaveBeenCalledWith('onClear');
});
it('normalizes pointer strokes, never drawing outside the bounded signature surface', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const f = mount('signature');
  const svg = screen.getByRole('img');
  Object.defineProperty(svg, 'setPointerCapture', { value: vi.fn() });
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 180,
    width: 600,
    height: 180,
    toJSON: () => ({}),
  });
  fireEvent.pointerMove(svg, { clientX: 100, clientY: 30 });
  expect(f.write).not.toHaveBeenCalled();
  fireEvent.pointerDown(svg);
  fireEvent.pointerMove(svg, { clientX: 300, clientY: 90 });
  expect(f.write).toHaveBeenLastCalledWith('value', [{ x: 0.5, y: 0.5, stroke: 1 }]);
  fireEvent.pointerMove(svg, { clientX: 700, clientY: -10 });
  expect(f.write).toHaveBeenLastCalledWith('value', [
    { x: 0.5, y: 0.5, stroke: 1 },
    { x: 1, y: 0, stroke: 1 },
  ]);
  expect(svg.querySelector('polyline')?.getAttribute('points')).toBe('300,90 600,0');
  fireEvent.pointerUp(svg);
  fireEvent.pointerMove(svg, { clientX: 200, clientY: 30 });
  expect(f.write).toHaveBeenCalledTimes(2);
  fireEvent.pointerDown(svg);
  fireEvent.pointerCancel(svg);
  fireEvent.pointerMove(svg, { clientX: 200, clientY: 30 });
  expect(f.write).toHaveBeenCalledTimes(2);
});

it('renders progress indicators from bounded numeric values and supports notification tones', () => {
  const progress = mount('progressIndicator', { value: 25, max: 50 });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  progress.view.unmount();
  const missing = mount('progressIndicator', { value: '' });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  missing.view.unmount();
  mount('badge', { tone: 'success' });
  expect(screen.getByText(i18n.t('components.field'))).toBeDefined();
});
