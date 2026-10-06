import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Bounded Retry-After handling shared by the browser session probes. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  const value =
    header === null
      ? 60
      : /^\d+$/.test(header)
        ? Number(header)
        : (Date.parse(header) - now) / 1000;
  return Number.isFinite(value) ? Math.max(1, Math.min(3600, Math.ceil(value))) : 60;
}

export function RetryAfterNotice({
  seconds,
  retry,
  trigger,
}: {
  seconds: number;
  retry: () => void;
  trigger?: unknown;
}) {
  const { t } = useTranslation(),
    callback = useRef(retry);
  useEffect(() => {
    callback.current = retry;
  }, [retry]);
  const [clock, setClock] = useState({ seconds, trigger, remaining: seconds });
  const remaining =
    clock.seconds === seconds && clock.trigger === trigger ? clock.remaining : seconds;
  useEffect(() => {
    const deadline = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setClock({ seconds, trigger, remaining: next });
      if (!next) {
        clearInterval(timer);
        callback.current();
      }
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [seconds, trigger]);
  return <p role="status">{t('common.retryAfter', { count: remaining })}</p>;
}
