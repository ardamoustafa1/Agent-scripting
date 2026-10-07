import { Contrast, Monitor, Moon, RotateCcw, Smartphone, Sun, Tablet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import {
  Alert,
  Button,
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
  type Theme,
} from '@verbis/ui';

import { DevicePreview } from '../preview/device.js';

import { CANVAS_BURST_MS, useCoalesced } from './canvas.js';
import { LiveSession } from './live-session.js';
import { useEditor, type EditorStore } from './store.js';
import '../preview/styles.css';

const DEVICES = {
  phone: { width: 375, height: 720, Icon: Smartphone },
  tablet: { width: 768, height: 1024, Icon: Tablet },
  desktop: { width: 1280, height: 800, Icon: Monitor },
} as const;
type Device = keyof typeof DEVICES;
const THEMES = { light: Sun, dark: Moon, 'high-contrast': Contrast } as const;
const LOCALES = ['tr', 'en'] as const;
type Locale = (typeof LOCALES)[number];

/**
 * Live agent view (DIFFERENTIATORS A1): the draft as an agent sees it, beside the canvas.
 * Edits hot-reload into the running simulation; the agent keeps their page and entered values.
 */
export function LivePane({ store }: { store: EditorStore }) {
  const state = useEditor(store),
    { t } = useTranslation();
  // Typing in the inspector is coalesced exactly like the canvas, so both panes move together.
  const { document, pageId } = useCoalesced(
    useMemo(
      () => ({ document: state.document, pageId: state.pageId }),
      [state.document, state.pageId],
    ),
    CANVAS_BURST_MS,
  );
  const [locale, setLocale] = useState<Locale>(
    () => LOCALES.find((l) => l === document.i18n.defaultLocale) ?? 'tr',
  );
  const [theme, setTheme] = useState<Theme>('light');
  const [device, setDevice] = useState<Device>('phone');
  const [i18n, setI18n] = useState<I18nInstance | null>(null);
  const [session] = useState(() => new LiveSession(locale));
  useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => {
    session.load(document);
  }, [session, document]);
  // Follow the page the designer opens; skip the first render so the flow starts normally.
  const followed = useRef(pageId);
  useEffect(() => {
    if (followed.current === pageId) return;
    followed.current = pageId;
    session.show(pageId);
  }, [session, pageId]);
  useEffect(() => {
    session.setLocale(locale);
    let cancelled = false;
    void createI18n(locale).then((instance) => {
      if (!cancelled) setI18n(instance);
    });
    return () => {
      cancelled = true;
    };
  }, [session, locale]);
  useEffect(
    () => () => {
      session.dispose();
    },
    [session],
  );

  const runtime = session.runtime;
  const current = runtime?.store.get('runtime.page');
  const page = document.pages.find((p) => p.id === current);
  const { width, height } = DEVICES[device];
  return (
    <section
      className="ed-live"
      aria-labelledby="ed-live-title"
      data-result={session.result}
      data-load-ms={session.loadMs.toFixed(1)}
    >
      <header className="ed-live-header">
        <div className="ed-live-heading">
          <h2 id="ed-live-title">{t('designer.live.title')}</h2>
          <span className="ed-live-status" data-live={session.result !== 'failed'}>
            {t(session.result === 'failed' ? 'designer.live.paused' : 'designer.live.live')}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          startIcon={<RotateCcw size={14} aria-hidden />}
          onClick={() => {
            session.restart();
          }}
        >
          {t('designer.live.restart')}
        </Button>
      </header>
      <Toolbar label={t('designer.live.controls')}>
        <ToolbarToggleGroup
          type="single"
          className="ed-live-segment"
          aria-label={t('designer.live.device')}
          value={device}
          onValueChange={(value) => {
            if (value in DEVICES) setDevice(value as Device);
          }}
        >
          {(Object.keys(DEVICES) as Device[]).map((key) => {
            const { Icon } = DEVICES[key];
            const label = t(`designer.live.devices.${key}`);
            return (
              <ToolbarToggleItem key={key} value={key} aria-label={label} title={label}>
                <Icon size={15} aria-hidden />
              </ToolbarToggleItem>
            );
          })}
        </ToolbarToggleGroup>
        <ToolbarToggleGroup
          type="single"
          className="ed-live-segment"
          aria-label={t('designer.live.language')}
          value={locale}
          onValueChange={(value) => {
            const next = LOCALES.find((l) => l === value);
            if (next) setLocale(next);
          }}
        >
          {LOCALES.map((key) => (
            <ToolbarToggleItem key={key} value={key} aria-label={t(`common.locale.${key}`)}>
              {key.toUpperCase()}
            </ToolbarToggleItem>
          ))}
        </ToolbarToggleGroup>
        <ToolbarToggleGroup
          type="single"
          className="ed-live-segment"
          aria-label={t('designer.live.theme')}
          value={theme}
          onValueChange={(value) => {
            if (value in THEMES) setTheme(value as Theme);
          }}
        >
          {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((key) => {
            const Icon = THEMES[key];
            const label = t(`common.theme.${key}`);
            return (
              <ToolbarToggleItem key={key} value={key} aria-label={label} title={label}>
                <Icon size={15} aria-hidden />
              </ToolbarToggleItem>
            );
          })}
        </ToolbarToggleGroup>
      </Toolbar>
      <p className="ed-live-where" aria-live="polite">
        {session.result === 'restarted'
          ? t('designer.live.restarted')
          : runtime?.store.get('runtime.ended') === true
            ? t('designer.live.ended')
            : page
              ? t('designer.live.page', { page: page.name })
              : ' '}
      </p>
      {session.result === 'failed' || !runtime ? (
        <Alert tone="warning" title={t('designer.live.failed')} />
      ) : (
        i18n && (
          <DevicePreview
            runtime={runtime}
            width={width}
            height={height}
            theme={theme}
            i18n={i18n}
            title={t('designer.live.frame', { name: document.meta.name })}
          />
        )
      )}
    </section>
  );
}
