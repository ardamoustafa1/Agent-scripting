import { describe, expect, it } from 'vitest';

import { creditCardSalesScript } from '../fixtures/credit-card-sales.js';
import { minimalScript } from '../fixtures/minimal.js';
import { ScriptDocumentSchema, type ScriptDocument } from '../schema/document.js';
import { NodeSchema, type Node } from '../schema/node.js';
import { validateScriptDocument } from '../validation/validate.js';

import { applyJsonPatch } from './json-patch.js';
import {
  duplicateNode,
  findNode,
  insertNode,
  moveNode,
  nextCopyId,
  removeNode,
  subtreeIds,
  TreeOperationError,
  updateNode,
  walkNodes,
  type EditResult,
} from './tree.js';

const doc = (): ScriptDocument => ScriptDocumentSchema.parse(creditCardSalesScript);
const node = (input: unknown): Node => NodeSchema.parse(input);
const childIds = (d: ScriptDocument, id: string) =>
  findNode(d, id)?.node.children?.map((child) => child.id);

/** Every edit must be replayable (redo) and reversible (undo) through its JSON Patch. */
function expectReversible(before: ScriptDocument, result: EditResult): void {
  expect(applyJsonPatch(before, result.patches)).toEqual(result.document);
  expect(applyJsonPatch(result.document, result.inversePatches)).toEqual(before);
}

function expectTreeError(fn: () => unknown, code: string): void {
  expect(fn).toThrow(TreeOperationError);
  expect(fn).toThrow(expect.objectContaining({ code, name: 'TreeOperationError' }));
}

describe('walkNodes / findNode', () => {
  it('visits pre-order across pages and can stop early', () => {
    const ids: string[] = [];
    walkNodes(doc(), ({ node: visited }) => {
      ids.push(visited.id);
      return visited.id !== 'welcome-greeting';
    });
    expect(ids).toEqual(['welcome-root', 'welcome-heading', 'welcome-greeting']);
  });

  it('locates nodes with parent, index, depth and pointer', () => {
    const location = findNode(doc(), 'btn-offer-accept');
    expect(location).toMatchObject({
      pageId: 'offer',
      pageIndex: 3,
      index: 1,
      depth: 3,
      pointer: '/pages/3/layout/children/2/children/1',
    });
    expect(location?.parent?.id).toBe('offer-actions');
    expect(findNode(doc(), 'offer-root')).not.toHaveProperty('parent');
    expect(findNode(doc(), 'nope')).toBeUndefined();
  });

  it('lists subtree ids', () => {
    expect(subtreeIds(findNode(doc(), 'offer-actions')!.node)).toEqual([
      'offer-actions',
      'btn-offer-decline',
      'btn-offer-accept',
    ]);
  });
});

describe('insertNode', () => {
  it('inserts at an index or appends, creating children when needed', () => {
    const before = doc();
    const first = insertNode(
      before,
      { parentId: 'offer-actions', index: 0 },
      node({ id: 'btn-help', type: 'button' }),
    );
    expect(childIds(first.document, 'offer-actions')).toEqual([
      'btn-help',
      'btn-offer-decline',
      'btn-offer-accept',
    ]);
    expectReversible(before, first);

    const second = insertNode(
      first.document,
      { parentId: 'btn-help' },
      node({ id: 'help-icon', type: 'text' }),
    );
    expect(childIds(second.document, 'btn-help')).toEqual(['help-icon']);
    expectReversible(first.document, second);
  });

  it('never mutates the input and freezes the output', () => {
    const before = doc();
    const snapshot = JSON.stringify(before);
    const { document } = insertNode(
      before,
      { parentId: 'offer-root' },
      node({ id: 'x', type: 'text' }),
    );
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(Object.isFrozen(document)).toBe(true);
    expect(document.pages[0]).toBe(before.pages[0]); // structural sharing
  });

  it('rejects bad targets and ids', () => {
    const d = doc();
    expectTreeError(
      () => insertNode(d, { parentId: 'nope' }, node({ id: 'x', type: 'box' })),
      'PARENT_NOT_FOUND',
    );
    expectTreeError(
      () => insertNode(d, { parentId: 'offer-root', index: 9 }, node({ id: 'x', type: 'box' })),
      'INDEX_OUT_OF_RANGE',
    );
    expectTreeError(
      () => insertNode(d, { parentId: 'offer-root', index: -1 }, node({ id: 'x', type: 'box' })),
      'INDEX_OUT_OF_RANGE',
    );
    expectTreeError(
      () => insertNode(d, { parentId: 'offer-root' }, node({ id: 'btn-verify', type: 'box' })),
      'DUPLICATE_ID',
    );
    expectTreeError(
      () =>
        insertNode(
          d,
          { parentId: 'offer-root' },
          node({ id: 'x', type: 'box', children: [{ id: 'x', type: 'box' }] }),
        ),
      'DUPLICATE_ID',
    );
    expectTreeError(
      () =>
        insertNode(
          d,
          { parentId: 'offer-root' },
          { id: 'Bad Id', type: 'box', props: {}, bindings: [], events: {} },
        ),
      'INVALID_ID',
    );
  });
});

describe('moveNode', () => {
  it('reorders within a parent (index after removal)', () => {
    const before = doc();
    const result = moveNode(before, 'btn-offer-decline', { parentId: 'offer-actions', index: 1 });
    expect(childIds(result.document, 'offer-actions')).toEqual([
      'btn-offer-accept',
      'btn-offer-decline',
    ]);
    expectReversible(before, result);
  });

  it('moves across parents and pages, appending by default', () => {
    const before = doc();
    const result = moveNode(before, 'offer-platinum-note', { parentId: 'welcome-root' });
    expect(childIds(result.document, 'welcome-root')?.at(-1)).toBe('offer-platinum-note');
    expect(findNode(result.document, 'offer-platinum-note')?.pageId).toBe('welcome');
    expectReversible(before, result);
  });

  it('moves a node out of an earlier sibling subtree (destination path shifts)', () => {
    const before = doc();
    const result = moveNode(before, 'btn-offer-accept', { parentId: 'offer-root', index: 0 });
    expect(childIds(result.document, 'offer-root')).toEqual([
      'btn-offer-accept',
      'offer-text',
      'offer-platinum-note',
      'offer-actions',
    ]);
    expectReversible(before, result);
  });

  it('rejects root moves, cycles, missing nodes and bad indices', () => {
    const d = doc();
    expectTreeError(
      () => moveNode(d, 'offer-root', { parentId: 'welcome-root' }),
      'ROOT_NODE_IMMUTABLE',
    );
    expectTreeError(
      () => moveNode(d, 'offer-actions', { parentId: 'btn-offer-accept' }),
      'MOVE_INTO_DESCENDANT',
    );
    expectTreeError(
      () => moveNode(d, 'offer-actions', { parentId: 'offer-actions' }),
      'MOVE_INTO_DESCENDANT',
    );
    expectTreeError(() => moveNode(d, 'nope', { parentId: 'offer-root' }), 'NODE_NOT_FOUND');
    expectTreeError(() => moveNode(d, 'offer-text', { parentId: 'nope' }), 'PARENT_NOT_FOUND');
    expectTreeError(
      () => moveNode(d, 'offer-text', { parentId: 'offer-root', index: 3 }),
      'INDEX_OUT_OF_RANGE',
    );
  });
});

describe('removeNode', () => {
  it('removes a subtree reversibly', () => {
    const before = doc();
    const result = removeNode(before, 'offer-actions');
    expect(findNode(result.document, 'btn-offer-accept')).toBeUndefined();
    expectReversible(before, result);
  });

  it('refuses to remove page roots', () => {
    expectTreeError(() => removeNode(doc(), 'welcome-root'), 'ROOT_NODE_IMMUTABLE');
    expectTreeError(() => removeNode(doc(), 'nope'), 'NODE_NOT_FOUND');
  });
});

describe('updateNode', () => {
  it('edits props through an immer recipe with minimal patches', () => {
    const before = doc();
    const result = updateNode(before, 'btn-offer-accept', (draft) => {
      draft.props['variant'] = 'secondary';
    });
    expect(result.patches).toEqual([
      {
        op: 'replace',
        path: '/pages/3/layout/children/2/children/1/props/variant',
        value: 'secondary',
      },
    ]);
    expectReversible(before, result);
  });

  it('rejects id and children replacement', () => {
    expectTreeError(
      () =>
        updateNode(doc(), 'offer-text', (draft) => {
          draft.id = 'renamed';
        }),
      'INVALID_ID',
    );
    expectTreeError(
      () =>
        updateNode(doc(), 'offer-actions', (draft) => {
          draft.children = [];
        }),
      'INVALID_ID',
    );
  });
});

describe('duplicateNode', () => {
  it('copies a subtree after itself with fresh ids and remapped internal references', () => {
    const base = ScriptDocumentSchema.parse(minimalScript());
    const withGroup = insertNode(
      base,
      { parentId: 'home-root' },
      node({
        id: 'group',
        type: 'box',
        children: [
          { id: 'in-pan', type: 'maskedInput' },
          {
            id: 'btn-mask',
            type: 'button',
            events: {
              onPress: [
                {
                  type: 'sequence',
                  actions: [
                    { type: 'maskField', node: 'in-pan' },
                    { type: 'maskField', node: 'btn-next' },
                  ],
                },
              ],
            },
          },
        ],
      }),
    ).document;

    const result = duplicateNode(withGroup, 'group');
    expect(result.newId).toBe('group-copy');
    expect([...result.idMap.entries()]).toEqual([
      ['group', 'group-copy'],
      ['in-pan', 'in-pan-copy'],
      ['btn-mask', 'btn-mask-copy'],
    ]);
    expect(childIds(result.document, 'home-root')).toEqual(['btn-next', 'group', 'group-copy']);
    const copiedButton = findNode(result.document, 'btn-mask-copy')?.node;
    expect(copiedButton?.events['onPress']).toEqual([
      {
        type: 'sequence',
        actions: [
          { type: 'maskField', node: 'in-pan-copy', masked: true },
          { type: 'maskField', node: 'btn-next', masked: true },
        ],
      },
    ]);
    expectReversible(withGroup, result);
  });

  it('keeps the duplicated document valid', () => {
    const result = duplicateNode(doc(), 'offer-actions');
    expect(validateScriptDocument(result.document).issues).toEqual([]);
  });

  it('numbers repeated copies deterministically', () => {
    const once = duplicateNode(doc(), 'offer-text').document;
    expect(duplicateNode(once, 'offer-text').newId).toBe('offer-text-copy-2');
    expect(duplicateNode(once, 'offer-text-copy').newId).toBe('offer-text-copy-2');
  });

  it('supports custom id generators and validates their output', () => {
    let n = 0;
    const result = duplicateNode(doc(), 'offer-text', { generateId: () => `gen-${(n += 1)}` });
    expect(result.newId).toBe('gen-1');
    expectTreeError(
      () => duplicateNode(doc(), 'offer-text', { generateId: () => 'Bad' }),
      'INVALID_ID',
    );
    expectTreeError(
      () => duplicateNode(doc(), 'offer-actions', { generateId: () => 'same' }),
      'DUPLICATE_ID',
    );
    expectTreeError(() => duplicateNode(doc(), 'offer-root'), 'ROOT_NODE_IMMUTABLE');
  });
});

describe('nextCopyId', () => {
  it('stays kebab-case and within 64 characters', () => {
    expect(nextCopyId('a', new Set())).toBe('a-copy');
    expect(nextCopyId('a', new Set(['a-copy', 'a-copy-2']))).toBe('a-copy-3');
    const long = `${'x'.repeat(58)}-y`;
    const id = nextCopyId(long, new Set());
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });
});

describe('random edit sequences (property)', () => {
  /** Mulberry32: deterministic PRNG (CLAUDE.md §8). */
  const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it.each([1, 2, 3, 4, 5, 42, 1337])(
    'seed %i: ids stay unique and the undo stack restores the original',
    (seed) => {
      const random = prng(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const original = doc();
      let current = original;
      const undo: EditResult[] = [];

      for (let step = 0; step < 40; step += 1) {
        const all: { id: string; isRoot: boolean; children: number }[] = [];
        walkNodes(current, ({ node: visited, parent }) => {
          all.push({
            id: visited.id,
            isRoot: parent === undefined,
            children: visited.children?.length ?? 0,
          });
          return true;
        });
        const movable = all.filter((entry) => !entry.isRoot);
        const target = pick(movable);
        const parent = pick(all);
        let result: EditResult | undefined;
        try {
          const op = Math.floor(random() * 4);
          if (op === 0)
            result = moveNode(current, target.id, {
              parentId: parent.id,
              index: Math.floor(random() * (parent.children + 1)),
            });
          else if (op === 1) result = duplicateNode(current, target.id);
          else if (op === 2 && movable.length > 20) result = removeNode(current, target.id);
          else
            result = insertNode(
              current,
              { parentId: parent.id },
              node({ id: `rand-${seed}-${step}`, type: 'text' }),
            );
        } catch (error) {
          expect(error).toBeInstanceOf(TreeOperationError);
        }
        if (result === undefined) continue;
        expect(applyJsonPatch(current, result.patches)).toEqual(result.document);
        const ids: string[] = [];
        walkNodes(result.document, ({ node: visited }) => {
          ids.push(visited.id);
          return true;
        });
        expect(new Set(ids).size).toBe(ids.length);
        undo.push(result);
        current = result.document;
      }

      for (let entry = undo.pop(); entry !== undefined; entry = undo.pop()) {
        current = applyJsonPatch(current, entry.inversePatches);
      }
      expect(current).toEqual(original);
    },
  );
});
