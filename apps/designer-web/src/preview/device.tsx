import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

import { ScriptRenderer, type Runtime } from '@verbis/core-runtime';
import type { I18nInstance } from '@verbis/i18n';
import { UiProvider, type Theme } from '@verbis/ui';

// Only the parent renders and handles the trusted runtime. Frame scripts stay disabled
// by both the sandbox and CSP; never combine allow-scripts with allow-same-origin.
const previewDocument = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; base-uri 'none'; form-action 'none'"></head><body></body></html>`;

const STYLE_TIMEOUT_MS = 1500;

function describeFrame(document: Document, lang: string, title: string) {
  document.documentElement.lang = lang;
  document.title = title;
}

/** A same-origin frame provides a real viewport for runtime media queries. */
export function DevicePreview({
  runtime,
  width,
  height,
  theme,
  i18n,
  title,
}: {
  runtime: Runtime;
  width: number;
  height: number;
  theme: Theme;
  i18n: I18nInstance;
  title: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(width);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth) setAvailableWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const scale = Math.min(1, Math.max(0.1, availableWidth / width));
  const frame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const element = frame.current;
    let cancelled = false;
    const mount = () => {
      const document = element?.contentDocument;
      if (!document) return;
      document.head.querySelectorAll('link[rel="stylesheet"],style').forEach((style) => {
        style.remove();
      });
      const pending: Promise<void>[] = [];
      for (const style of window.document.querySelectorAll('link[rel="stylesheet"],style')) {
        const copy = style.cloneNode(true) as HTMLElement;
        if (copy.tagName === 'LINK')
          pending.push(
            new Promise((resolve) => {
              copy.addEventListener(
                'load',
                () => {
                  resolve();
                },
                { once: true },
              );
              copy.addEventListener(
                'error',
                () => {
                  resolve();
                },
                { once: true },
              );
            }),
          );
        document.head.append(copy);
      }
      document.body.style.margin = '0';
      // Render only once the copied styles apply: otherwise the agent view flashes unstyled
      // controls that then animate into their themed colors.
      // A stylesheet that never settles must not leave the preview blank.
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, STYLE_TIMEOUT_MS));
      void Promise.race([Promise.all(pending), timeout]).then(() => {
        if (!cancelled) setBody(document.body);
      });
    };
    // Wait for srcDoc to load; portaling into the initial about:blank document
    // would lose its content and its event bindings when the frame navigates.
    if (element?.contentDocument?.querySelector('meta[http-equiv="Content-Security-Policy"]'))
      mount();
    element?.addEventListener('load', mount);
    return () => {
      cancelled = true;
      element?.removeEventListener('load', mount);
    };
  }, []);
  // A new runtime (live hot reload) only updates metadata; styles are copied once per frame load.
  const lang = runtime.store.locale;
  useEffect(() => {
    const document = body ? frame.current?.contentDocument : undefined;
    if (document) describeFrame(document, lang, title);
  }, [body, lang, title]);
  return (
    // The bounded viewport must be focusable so keyboard users can scroll around the iframe.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div ref={host} className="pv-device-scroll" role="region" aria-label={title} tabIndex={0}>
      <div style={{ width: width * scale, height: height * scale }}>
        <iframe
          ref={frame}
          title={title}
          srcDoc={previewDocument}
          sandbox="allow-same-origin"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      </div>
      {body &&
        createPortal(
          <UiProvider theme={theme} i18n={i18n}>
            <main aria-label={title}>
              <h1 className="vb-sr-only">{title}</h1>
              <ScriptRenderer runtime={runtime} autoStart={false} />
            </main>
          </UiProvider>,
          body,
        )}
    </div>
  );
}
