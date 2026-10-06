/** Named dependency boundaries keep lazy feature imports separate from the entry graph. */
export function browserChunks(id) {
  const library = id.match(
    /\/packages\/(core-runtime|components|expr|script-schema|i18n|ui)\/dist\//,
  )?.[1];
  if (library) return `library-${library}`;
  if (!id.includes('/node_modules/')) return undefined;
  if (/\/(?:react|react-dom|scheduler)\//.test(id)) return 'react';
  if (/\/(?:radix-ui|@radix-ui)\//.test(id)) return 'controls';
  if (/\/(?:recharts|recharts-scale)\//.test(id)) return 'charts';
  if (/\/(?:d3-[^/]+|victory-vendor)\//.test(id)) return 'chart-math';
  if (/\/(?:three)\//.test(id)) return 'three-preview';
  if (/\/(?:zod)\//.test(id)) return 'schemas';
  if (/\/(?:@codemirror|@lezer|codemirror)\//.test(id)) return 'expression-editor';
  if (/\/(?:@xyflow)\//.test(id)) return 'flow-editor';
  if (/\/(?:yjs|y-protocols|@hocuspocus|lib0)\//.test(id)) return 'collaboration';
  return undefined;
}
