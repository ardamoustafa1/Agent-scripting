import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

import { fetchAgentSession, launchSocketTicket, redeemCode, LaunchApiError } from './launch-api.js';

const OfferSchema = /^[A-Za-z0-9_-]{43}$/;

/**
 * Mode A: the agent desktop waits for "new interaction" offers on a ticket-authenticated socket and
 * redeems them over HTTP. Without an assigned interaction nothing can open (SECURITY §4.1).
 */
export function useLaunchOffers(
  enabled: boolean,
  navigate: (path: string) => void,
  onFailure?: (error: LaunchApiError) => void,
): 'connecting' | 'connected' | 'disconnected' {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  useEffect(() => {
    if (!enabled) return;
    const closed = { value: false };
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let socket: ReturnType<typeof io> | undefined;
    const connect = async () => {
      let session;
      try {
        session = await fetchAgentSession();
      } catch (error) {
        if (closed.value) return;
        setStatus('disconnected');
        onFailure?.(
          error instanceof LaunchApiError ? error : new LaunchApiError('VERBIS_HTTP_UNAVAILABLE'),
        );
        retry = setTimeout(
          () => {
            void connect();
          },
          Math.min(10000, 1000 * 2 ** Math.min(attempt++, 4)),
        );
        return;
      }
      if (session?.user.authMethod !== 'sso' || closed.value) {
        if (!closed.value) setStatus('disconnected');
        return;
      }
      socket = io('/launch', {
        transports: ['websocket'],
        auth: (callback) => {
          void launchSocketTicket(session.csrfToken)
            .then((ticket) => {
              callback({ ticket });
            })
            .catch((error: unknown) => {
              if (closed.value) return;
              setStatus('disconnected');
              onFailure?.(
                error instanceof LaunchApiError
                  ? error
                  : new LaunchApiError('VERBIS_HTTP_UNAVAILABLE'),
              );
              callback({});
            });
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
      socket.on('connect', () => {
        setStatus('connected');
      });
      socket.on('disconnect', () => {
        setStatus('disconnected');
      });
      socket.on('connect_error', () => {
        setStatus('disconnected');
      });
      socket.on('launch.offer', (offer: unknown) => {
        if (closed.value) return;
        const code = (offer as { code?: unknown } | null)?.code;
        if (typeof code !== 'string' || !OfferSchema.test(code)) return;
        void redeemCode(code, session.csrfToken)
          .then((result) => {
            if (!closed.value) navigate(result.path);
          })
          .catch((error: unknown) => {
            if (!closed.value)
              onFailure?.(
                error instanceof LaunchApiError
                  ? error
                  : new LaunchApiError('VERBIS_HTTP_UNAVAILABLE'),
              );
          });
      });
    };
    void connect();
    return () => {
      closed.value = true;
      if (retry) clearTimeout(retry);
      socket?.disconnect();
    };
  }, [enabled, navigate, onFailure]);
  return status;
}
