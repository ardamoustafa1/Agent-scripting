import { z } from 'zod';

/**
 * Designer preview (SECURITY §4.5): a distinct `preview` session kind that never attaches to a
 * real interaction. It runs on a mock interaction and reaches live data sources only when the
 * starter held the integration-execute permission and asked for it explicitly.
 */
export const PreviewTraceSchema = z.object({
  preview: z.literal(true),
  liveDataSources: z.boolean(),
});

export function previewMayUseLiveData(session: {
  readonly kind: string;
  readonly decisionTrace: unknown;
}): boolean {
  if (session.kind !== 'preview') return true;
  const trace = PreviewTraceSchema.safeParse(session.decisionTrace);
  return trace.success && trace.data.liveDataSources;
}
