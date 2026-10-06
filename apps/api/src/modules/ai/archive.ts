import { inflateRawSync } from 'node:zlib';

/** Verify actual expansion, rather than trusting attacker-controlled ZIP size declarations. */
export function checkDocxArchive(bytes: Buffer): void {
  let expanded = 0;
  let entries = 0;
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    entries++;
    const declared = bytes.readUInt32LE(i + 24);
    const compressed = bytes.readUInt32LE(i + 20);
    const method = bytes.readUInt16LE(i + 10);
    const offset = bytes.readUInt32LE(i + 42);
    if (
      entries > 1000 ||
      expanded + declared > 2_000_000 ||
      bytes.readUInt16LE(i + 8) & 1 ||
      ![0, 8].includes(method)
    )
      throw new Error('ARCHIVE_LIMIT');
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50)
      throw new Error('ARCHIVE_INVALID');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    if (start + compressed > bytes.length) throw new Error('ARCHIVE_INVALID');
    const packed = bytes.subarray(start, start + compressed);
    const plain =
      method === 8
        ? inflateRawSync(packed, { maxOutputLength: Math.max(1, 2_000_000 - expanded) })
        : packed;
    if (plain.length !== declared) throw new Error('ARCHIVE_SIZE_MISMATCH');
    expanded += plain.length;
  }
  if (!entries) throw new Error('ARCHIVE_INVALID');
}
