import { useEffect, useRef, useState } from 'react';

import {
  fetchAgentSession,
  LaunchApiError,
  redeemCode,
  redeemEmbedded,
  redeemJws,
  reportIgnoredParams,
  type LaunchResult,
} from './launch-api.js';
import { identifyingParams, parseLaunchFragment, scrubLocation } from './launch-fragment.js';

export type LaunchState =
  | { readonly status: 'checking' }
  | { readonly status: 'signedOut' }
  | { readonly status: 'breakGlass' }
  | { readonly status: 'noLaunch' }
  | { readonly status: 'launching' }
  | {
      readonly status: 'denied';
      readonly code: string;
      readonly correlationId?: string;
      /** Embedded launches only: the connector, so the page can offer the platform account link. */
      readonly connectorId?: string;
      /** Embedded launches only: re-run the same verified launch (e.g. after linking). */
      readonly retry?: () => void;
    }
  | { readonly status: 'launched'; readonly result: LaunchResult };

export interface LaunchDeps {
  readonly navigate: (path: string) => void;
  readonly win?: Pick<Window, 'history' | 'location'>;
}

/**
 * /launch: read the fragment once, scrub the URL *before* any network call, require an SSO session,
 * then exchange. The server decides everything; this hook never selects a script itself.
 */
export function useLaunch({ navigate, win = window }: LaunchDeps): LaunchState {
  const [state, setState] = useState<LaunchState>({ status: 'checking' });
  const started = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const isMounted = (): boolean => mounted.current;
    const cleanup = (): void => {
      mounted.current = false;
    };
    if (started.current) return cleanup; // StrictMode double effect: the code is single-use
    started.current = true;
    const material = parseLaunchFragment(win.location.hash);
    const ignored = identifyingParams(win.location.search);
    scrubLocation(win);
    void (async () => {
      const session = await fetchAgentSession().catch(() => undefined);
      if (!isMounted()) return;
      if (session === undefined) {
        setState({ status: 'denied', code: 'VERBIS_HTTP_UNAVAILABLE' });
        return;
      }
      if (session === null) {
        setState({ status: 'signedOut' });
        return;
      }
      if (session.user.authMethod !== 'sso') {
        setState({ status: 'breakGlass' });
        return;
      }
      await reportIgnoredParams(ignored, session.csrfToken);
      if (!isMounted()) return;
      if (material === undefined) {
        setState({ status: 'noLaunch' });
        return;
      }
      const run = async (): Promise<void> => {
        if (!isMounted()) return;
        setState({ status: 'launching' });
        try {
          const result =
            material.kind === 'code'
              ? await redeemCode(material.code, session.csrfToken)
              : material.kind === 'jws'
                ? await redeemJws(material.token, session.csrfToken)
                : await redeemEmbedded(
                    material.connectorId,
                    material.conversationId,
                    session.csrfToken,
                  );
          if (!isMounted()) return;
          setState({ status: 'launched', result });
          navigate(result.path);
        } catch (error) {
          if (!isMounted()) return;
          const code = error instanceof LaunchApiError ? error.code : 'VERBIS_HTTP_UNAVAILABLE';
          const correlationId =
            error instanceof LaunchApiError ? error.correlationId : crypto.randomUUID();
          // Codes and JWS are single-use; only the embedded hint may be re-verified.
          setState(
            material.kind === 'embedded'
              ? {
                  status: 'denied',
                  code,
                  correlationId,
                  connectorId: material.connectorId,
                  retry: () => void run(),
                }
              : { status: 'denied', code, correlationId },
          );
        }
      };
      await run();
    })();
    return cleanup;
  }, [navigate, win]);

  return state;
}
