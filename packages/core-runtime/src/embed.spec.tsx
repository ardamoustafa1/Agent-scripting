import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import {
  EmbedFrame,
  EmbedImage,
  EmbedVideo,
  safeEmbedUrl,
  subscribeFrameMessages,
} from './embed.js';

it('rejects untrusted origins, credentials, and active URLs at the primitive boundary', () => {
  for (const value of [
    'javascript:alert(1)',
    'http://media.test/image',
    'https://user:pass@media.test/image',
    'https://other.test/image',
  ])
    expect(() => safeEmbedUrl(value, ['https://media.test'])).toThrow();
});
it('retains accessible media, captions, sandbox and failure telemetry', () => {
  const failed = vi.fn();
  const origins = ['https://media.test'];
  render(
    <>
      <EmbedImage src="https://media.test/a" label="Picture" origins={origins} failed={failed} />
      <EmbedFrame src="https://media.test/frame" label="Frame" origins={origins} />
      <EmbedVideo
        src="https://media.test/video"
        captions="https://media.test/captions"
        language="en"
        label="Video"
        origins={origins}
      />
    </>,
  );
  fireEvent.error(screen.getByRole('img'));
  expect(failed).toHaveBeenCalledOnce();
  expect(screen.getByTitle('Frame').getAttribute('sandbox')).toBe('');
  expect(document.querySelector('track')?.getAttribute('src')).toBe('https://media.test/captions');
});
it('isolates hosted messages by origin and frame window and unsubscribes on cleanup', () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const receive = vi.fn(),
    stop = subscribeFrameMessages({ current: frame }, 'https://psp.test', receive);
  window.dispatchEvent(
    new MessageEvent('message', { origin: 'https://evil.test', source: frame.contentWindow }),
  );
  window.dispatchEvent(new MessageEvent('message', { origin: 'https://psp.test', source: window }));
  expect(receive).not.toHaveBeenCalled();
  window.dispatchEvent(
    new MessageEvent('message', { origin: 'https://psp.test', source: frame.contentWindow }),
  );
  expect(receive).toHaveBeenCalledOnce();
  stop();
  window.dispatchEvent(
    new MessageEvent('message', { origin: 'https://psp.test', source: frame.contentWindow }),
  );
  expect(receive).toHaveBeenCalledOnce();
  frame.remove();
});
