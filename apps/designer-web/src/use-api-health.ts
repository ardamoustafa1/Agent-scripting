import { useQuery } from '@tanstack/react-query';

import { HealthStatusSchema } from '@verbis/shared-types';
import { type Status } from '@verbis/ui';

/**
 * Polls the platform API readiness endpoint through the same-origin /api proxy.
 * The body is validated: a 200 from something else (e.g. an SPA fallback page) is not "up".
 */
export function useApiHealth(): Status {
  const query = useQuery({
    queryKey: ['api-health'],
    queryFn: async () => {
      const response = await fetch('/api/health/ready', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return false;
      const parsed = HealthStatusSchema.safeParse(await response.json().catch(() => null));
      return parsed.success && parsed.data.status === 'ok';
    },
    refetchInterval: 15_000,
  });
  if (query.isPending) return 'unknown';
  return query.data === true ? 'up' : 'down';
}
