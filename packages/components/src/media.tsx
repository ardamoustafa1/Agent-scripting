import { useEffect, useRef, useState } from 'react';

import { EmbedImage, EmbedVideo, EmbedFrame, type RendererProps } from '@verbis/core-runtime';
import { Alert, Badge, Progress, Input } from '@verbis/ui';

import { useComponentEnvironment } from './environment.js';
import { MediaSchema } from './schemas.js';
import { Frame, CoreAction, useField, useLabels } from './shared.js';

export function MediaComponent(component: RendererProps) {
  const p = MediaSchema.parse(component.props),
    { text, t } = useLabels(component),
    environment = useComponentEnvironment(),
    f = useField(component);
  const [remaining, setRemaining] = useState(p.durationSec),
    elapsed = useRef(false),
    start = useRef(environment.now());
  const emit = component.emit,
    type = component.node.type;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  useEffect(() => {
    if (!['timer', 'countdown'].includes(type)) return;
    start.current = environment.now();
    elapsed.current = false;
    const tick = () => {
      const next = Math.max(
        0,
        p.durationSec - Math.floor((environment.now() - start.current) / 1000),
      );
      setRemaining(next);
      if (next === 0 && !elapsed.current) {
        elapsed.current = true;
        void emit('onElapsed').catch(() => undefined);
      }
    };
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [type, emit, p.durationSec, environment]);
  let content;
  switch (component.node.type) {
    case 'image':
      content = p.url ? (
        <EmbedImage
          className="vc-image"
          src={p.url}
          origins={environment.mediaOrigins}
          label={text(p.altKey)}
          failed={() => {
            component.runtime.event(
              'component',
              'failed',
              'VERBIS_EMBED_FAILED',
              component.node.id,
            );
          }}
        />
      ) : (
        <Alert title={t('components.unconfigured')} />
      );
      break;
    case 'video':
      content =
        p.url && p.captionsUrl ? (
          <EmbedVideo
            className="vc-video"
            src={p.url}
            origins={environment.mediaOrigins}
            label={text(p.labelKey)}
            captions={p.captionsUrl}
            language={component.runtime.store.locale}
            poster={p.poster}
            failed={() => {
              component.runtime.event(
                'component',
                'failed',
                'VERBIS_EMBED_FAILED',
                component.node.id,
              );
            }}
          />
        ) : (
          <Alert title={t('components.unconfigured')} />
        );
      break;
    case 'iframe':
      content = p.url ? (
        <EmbedFrame
          className="vc-frame"
          src={p.url}
          origins={environment.frameOrigins}
          label={text(p.labelKey)}
          failed={() => {
            component.runtime.event(
              'component',
              'failed',
              'VERBIS_EMBED_FAILED',
              component.node.id,
            );
          }}
        />
      ) : (
        <Alert title={t('components.unconfigured')} />
      );
      break;
    case 'timer':
    case 'countdown':
      content = (
        <>
          <output aria-label={text(p.labelKey)} className="vc-countdown">
            {clock}
          </output>
          <Progress label={text(p.labelKey)} value={(remaining / p.durationSec) * 100} />
          {p.timer && (
            <CoreAction
              component={component}
              labelKey="components.start"
              actions={[{ type: 'startTimer', timer: p.timer }]}
            />
          )}
          {remaining === 0 && <span role="status">{t('components.elapsed')}</span>}
        </>
      );
      break;
    case 'badge':
      content = <Badge tone={p.tone}>{text(p.labelKey)}</Badge>;
      break;
    case 'progressIndicator':
      content = (
        <Progress
          label={text(p.labelKey)}
          value={typeof p.value === 'number' ? (p.value / p.max) * 100 : 0}
        />
      );
      break;
    default:
      content = (
        <Input
          label={text(p.labelKey)}
          value={typeof f.value === 'string' ? f.value : ''}
          disabled={f.disabled}
          onChange={(event) => {
            f.write(event.target.value);
          }}
        />
      );
  }
  return <Frame component={component}>{content}</Frame>;
}
interface Point {
  x: number;
  y: number;
  stroke: number;
}
export function Signature(component: RendererProps) {
  const environment = useComponentEnvironment(),
    f = useField(component),
    { t } = useLabels(component);
  const [points, setPoints] = useState<Point[]>([]),
    [typed, setTyped] = useState(''),
    drawing = useRef(false),
    stroke = useRef(0);
  if (!environment.features.includes('signature'))
    return (
      <Frame component={component}>
        <Alert title={t('components.optionalFeature')} />
      </Frame>
    );
  const write = (next: Point[]) => {
    setPoints(next);
    f.write(next.map((point) => ({ ...point })));
  };
  return (
    <Frame component={component}>
      <label id={`${component.node.id}-signature-label`}>{f.label}</label>
      <svg
        viewBox="0 0 600 180"
        role="img"
        aria-labelledby={`${component.node.id}-signature-label`}
        className="vc-signature"
        onPointerDown={(event) => {
          if (f.disabled) return;
          drawing.current = true;
          stroke.current++;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
        onPointerMove={(event) => {
          if (!drawing.current || points.length >= 2000) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          write([
            ...points,
            {
              x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
              y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
              stroke: stroke.current,
            },
          ]);
        }}
      >
        {Array.from(new Set(points.map((point) => point.stroke))).map((group) => (
          <polyline
            key={group}
            points={points
              .filter((point) => point.stroke === group)
              .map((point) => `${point.x * 600},${point.y * 180}`)
              .join(' ')}
            fill="none"
            stroke="var(--vb-color-text)"
            strokeWidth="2"
          />
        ))}
      </svg>
      <Input
        label={t('components.typedSignature')}
        disabled={f.disabled}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          f.write(event.target.value);
        }}
      />
      <CoreAction
        component={{
          ...component,
          enabled: !f.disabled,
          emit: async () => {
            setPoints([]);
            setTyped('');
            f.write('');
            await component.emit('onClear');
          },
        }}
        labelKey="components.clear"
      />
    </Frame>
  );
}
