import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { creditCardSalesScript } from '@verbis/script-schema/fixtures';

import { checksumOf, decodeDocument, encodeDocument } from './document-storage.js';

const document = ScriptDocumentSchema.parse(creditCardSalesScript);

describe('document storage', () => {
  it('stores small documents as JSON', async () => {
    const stored = await encodeDocument(document, 10 * 1024 * 1024);
    expect(stored.encoding).toBe('json');
    expect(stored.size).toBeGreaterThan(1000);
    expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await decodeDocument({
        documentEncoding: 'json',
        document: stored.document,
        documentCompressed: null,
      }),
    ).toBe(document);
  });

  it('gzips documents above the threshold and round-trips them', async () => {
    const stored = await encodeDocument(document, 1024);
    expect(stored.encoding).toBe('gzip');
    if (stored.encoding !== 'gzip') return;
    expect(stored.compressed.byteLength).toBeLessThan(stored.size);
    const decoded = await decodeDocument({
      documentEncoding: 'gzip',
      document: null,
      documentCompressed: stored.compressed,
    });
    expect(decoded).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it('fails when the compressed payload is missing', async () => {
    await expect(
      decodeDocument({ documentEncoding: 'gzip', document: null, documentCompressed: null }),
    ).rejects.toThrow();
  });

  it('ignores designer positions in the checksum but not content', () => {
    const moved = structuredClone(document);
    const node = moved.flow.nodes[0];
    if (node !== undefined) node.position = { x: 999, y: 999 };
    moved.flow.designer = {
      groups: [{ id: 'group', label: 'Review', nodes: [node?.id ?? 'n-end'] }],
      notes: [{ id: 'note', text: 'Review needed', position: { x: 1, y: 2 } }],
    };
    expect(checksumOf(moved)).toBe(checksumOf(document));
    const renamed = { ...document, meta: { ...document.meta, name: 'Other' } };
    expect(checksumOf(renamed)).not.toBe(checksumOf(document));
  });
});
