import { deflateRawSync } from 'node:zlib';

import { expect, it } from 'vitest';

import { checkDocxArchive } from './archive.js';

function archive(text: string, declared: number) {
  const packed = deflateRawSync(Buffer.from(text));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(declared, 24);
  return Buffer.concat([local, packed, central]);
}
it('does not trust a ZIP entry claiming smaller uncompressed data', () => {
  expect(() => {
    checkDocxArchive(archive('Synthetic text', 1));
  }).toThrow('ARCHIVE_SIZE_MISMATCH');
});
it('accepts bounded verified expansion', () => {
  expect(() => {
    checkDocxArchive(archive('Synthetic text', 14));
  }).not.toThrow();
});
it('refuses malformed input before invoking the document parser', () => {
  expect(() => {
    checkDocxArchive(Buffer.from('not a zip'));
  }).toThrow('ARCHIVE_INVALID');
});
