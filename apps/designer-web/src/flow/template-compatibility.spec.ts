import { it } from 'vitest';

import { ScriptDocumentSchema, walkNodes } from '@verbis/script-schema';
import { VALID_FIXTURES } from '@verbis/script-schema/fixtures';

import { editorRegistry } from '../editor/store.js';

it('validates literal properties and binding contracts in every bundled template', () => {
  const errors: unknown[] = [];
  for (const [name, input] of Object.entries(VALID_FIXTURES)) {
    const doc = ScriptDocumentSchema.parse(input);
    walkNodes(doc, ({ node }) => {
      const d = editorRegistry.get(node.type);
      const props = d.propsSchema.safeParse({ ...d.defaults, ...node.props });
      if (!props.success) errors.push([name, node.id, 'PROPS', props.error.issues]);
      for (const binding of node.bindings)
        if (!d.bindableProps.includes(binding.prop))
          errors.push([name, node.id, 'BIND', binding.prop, d.bindableProps]);
      for (const event of Object.keys(node.events))
        if (!d.events.includes(event)) errors.push([name, node.id, 'EVENT', event, d.events]);
      return true;
    });
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
});
