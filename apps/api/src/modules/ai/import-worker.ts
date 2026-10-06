import { parentPort, workerData } from 'node:worker_threads';

import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { AiRequest } from '@verbis/shared-types';
import { AiRequestSchema } from '@verbis/shared-types';

import { checkDocxArchive } from './archive.js';

async function extractText(file: NonNullable<AiRequest['file']>): Promise<string> {
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.length > 1_500_000 || !bytes.length) throw new Error('FILE_SIZE');
  let text = '';
  if (file.kind === 'docx') {
    if (bytes.subarray(0, 2).toString() !== 'PK') throw new Error('FILE_TYPE');
    checkDocxArchive(bytes);
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('FILE_TYPE');
    const loader = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      disableFontFace: true,
    });
    try {
      const pdf = await loader.promise;
      if (pdf.numPages > 100) throw new Error('PAGE_LIMIT');
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
        if (text.length > 64000) throw new Error('TEXT_LIMIT');
      }
    } finally {
      await loader.destroy();
    }
  }
  if (!text.trim() || text.length > 64000) throw new Error('TEXT_LIMIT');
  return text;
}
const file = AiRequestSchema.shape.file.unwrap().parse(workerData);
void extractText(file)
  .then((text) => parentPort?.postMessage({ text }))
  .catch(() => parentPort?.postMessage({ error: true }));
