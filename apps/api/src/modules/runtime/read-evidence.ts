import { canonicalJson, sha256Hex } from '../../common/crypto/canonical-json.js';

/**
 * Evidence that an agent acknowledged a specific legal text. The checksum covers the page, node
 * id and every node prop (the text itself), so an acknowledgement recorded against one wording is
 * never accepted for another wording, even though the node id is stable.
 */
export function readEvidenceChecksum(input: {
  readonly pageId: string;
  readonly nodeId: string;
  readonly props: Readonly<Record<string, unknown>>;
}): string {
  return sha256Hex(canonicalJson({ v: 1, ...input }));
}

/** An old acknowledgement is valid only while the text checksum is unchanged. */
export function acknowledgementCurrent(recorded: string | undefined, current: string): boolean {
  return recorded !== undefined && recorded === current;
}
