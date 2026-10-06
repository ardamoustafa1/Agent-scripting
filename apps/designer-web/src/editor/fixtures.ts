import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

export function editorFixture(count = 1) {
  const input = minimalScript();
  const document = ScriptDocumentSchema.parse(input);
  document.pages[0]?.layout.children?.push(
    ...Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
      id: `fixture-${i}`,
      type: 'box',
      props: {},
      bindings: [],
      events: {},
      style: { base: { padding: 'sm' as const } },
    })),
  );
  return {
    id: '01928f3a-0000-7000-8000-000000000009',
    number: 1,
    version: 1,
    state: 'draft' as const,
    document,
    screens: [],
  };
}
