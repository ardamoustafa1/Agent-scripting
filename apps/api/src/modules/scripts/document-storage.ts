import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

import type { ScriptDocument } from '@verbis/script-schema';

import { canonicalJson, sha256Hex } from '../../common/crypto/canonical-json.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type StoredDocument =
  | { encoding: 'json'; document: ScriptDocument; compressed: null; size: number; checksum: string }
  | {
      encoding: 'gzip';
      document: null;
      compressed: Uint8Array<ArrayBuffer>;
      size: number;
      checksum: string;
    };

/** Canonical form for checksums: sorted keys, designer-only `position` data removed (SCRIPT_MODEL §9). */
export function checksumOf(document: ScriptDocument): string {
  const stripFlow = (flow: ScriptDocument['flow']) => {
    const { designer: _designer, ...rest } = flow;
    return { ...rest, nodes: flow.nodes.map(({ position: _position, ...node }) => node) };
  };
  const withoutPositions = {
    ...document,
    flow: stripFlow(document.flow),
    subflows: document.subflows.map(stripFlow),
  };
  return sha256Hex(canonicalJson(withoutPositions));
}

/**
 * Small documents are stored as JSONB (queryable, TOAST/lz4-compressed by Postgres); documents
 * above the threshold are gzip-compressed canonical JSON (ADR-0011).
 */
export async function encodeDocument(
  document: ScriptDocument,
  thresholdBytes: number,
): Promise<StoredDocument> {
  const canonical = canonicalJson(document);
  const size = Buffer.byteLength(canonical, 'utf8');
  const checksum = checksumOf(document);
  if (size <= thresholdBytes)
    return { encoding: 'json', document, compressed: null, size, checksum };
  const compressed = new Uint8Array(await gzipAsync(canonical, { level: 6 }));
  return { encoding: 'gzip', document: null, compressed, size, checksum };
}

export async function decodeDocument(row: {
  documentEncoding: 'json' | 'gzip';
  document: unknown;
  documentCompressed: Uint8Array | null;
}): Promise<unknown> {
  if (row.documentEncoding === 'json') return row.document;
  if (row.documentCompressed === null) throw new Error('Compressed document missing');
  return JSON.parse((await gunzipAsync(row.documentCompressed)).toString('utf8')) as unknown;
}
