import { forwardRef, type RefObject } from 'react';

import { RuntimeProblem } from './problem.js';

export function safeEmbedUrl(input: string, origins: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RuntimeProblem('VERBIS_COMPONENT_URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin))
    throw new RuntimeProblem('VERBIS_COMPONENT_URL');
  return url.href;
}
interface EmbedProps {
  src: string;
  origins: readonly string[];
  label: string;
  className?: string | undefined;
  failed?: (() => void) | undefined;
}
export function EmbedImage({ src, origins, label, className, failed }: EmbedProps) {
  return (
    <img
      data-core-embed="image"
      className={className}
      src={safeEmbedUrl(src, origins)}
      alt={label}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={failed}
    />
  );
}
export function EmbedVideo({
  src,
  origins,
  label,
  className,
  failed,
  captions,
  language,
  poster,
}: EmbedProps & { captions: string; language: string; poster?: string | undefined }) {
  return (
    <video
      data-core-embed="video"
      className={className}
      controls
      preload="metadata"
      aria-label={label}
      onError={failed}
      {...(poster ? { poster: safeEmbedUrl(poster, origins) } : {})}
    >
      <source src={safeEmbedUrl(src, origins)} />
      <track
        kind="captions"
        src={safeEmbedUrl(captions, origins)}
        srcLang={language}
        label={label}
        default
      />
    </video>
  );
}
export const EmbedFrame = forwardRef<
  HTMLIFrameElement,
  EmbedProps & { hostedCapture?: boolean | undefined }
>(function EmbedFrame({ src, origins, label, className, failed, hostedCapture = false }, ref) {
  const url = safeEmbedUrl(src, origins);
  if (hostedCapture && new URL(url).origin === window.location.origin)
    throw new RuntimeProblem('VERBIS_COMPONENT_URL');
  return (
    <iframe
      ref={ref}
      data-core-embed="frame"
      title={label}
      src={url}
      className={className}
      sandbox={hostedCapture ? 'allow-scripts allow-forms allow-same-origin' : ''}
      allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'"
      referrerPolicy="no-referrer"
      loading={hostedCapture ? 'eager' : 'lazy'}
      onError={failed}
    />
  );
});
/** A hosted iframe may send receipts only from its configured origin AND its actual window. */
export function subscribeFrameMessages(
  frame: RefObject<HTMLIFrameElement>,
  origin: string,
  receive: (event: MessageEvent<unknown>) => void,
): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin === origin && event.source === frame.current?.contentWindow) receive(event);
  };
  window.addEventListener('message', listener);
  return () => {
    window.removeEventListener('message', listener);
  };
}
