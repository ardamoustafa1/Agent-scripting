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
    let socket: ReturnType<typeof io> | undefined;
    void (async () => {
      const session = await fetchAgentSession().catch(() => null);
      if (session?.user.authMethod !== 'sso' || closed.value) return;
      socket = io('/launch', {
        transports: ['websocket'],
        auth: (callback) => {
          void launchSocketTicket(session.csrfToken)
            .then((ticket) => {
              callback({ ticket });
            })
            .catch(() => {
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
    })();
    return () => {
      closed.value = true;
      socket?.disconnect();
    };
  }, [enabled, navigate, onFailure]);
  return status;
}
