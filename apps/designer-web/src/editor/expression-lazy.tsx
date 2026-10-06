import { lazy, Suspense } from 'react';

import { Skeleton } from '@verbis/ui';

import type { ExpressionEditor as LoadedExpressionEditor } from './expression.js';

const Editor = lazy(() =>
  import('./expression.js').then((module) => ({ default: module.ExpressionEditor })),
);
export function ExpressionEditor(props: Parameters<typeof LoadedExpressionEditor>[0]) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Editor {...props} />
    </Suspense>
  );
}
