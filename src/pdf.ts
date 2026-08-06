import { readFile } from 'node:fs/promises';
// pdf-parse is CommonJS; import the implementation module directly to avoid its
// debug-mode index that tries to read a test file at import time.
// @ts-ignore - pdf-parse/lib/pdf-parse.js has no types
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export interface PdfExtract {
  text: string;
  pages: number;
}

/**
 * Extract text + page count from a PDF file on disk.
 * Returns empty text (not throwing) if the PDF is image-only/unparseable,
 * so callers can still store the asset.
 */
export async function extractPdf(filePath: string): Promise<PdfExtract> {
  try {
    const buf = await readFile(filePath);
    const data = await pdfParse(buf);
    return {
      text: (data.text || '').trim(),
      pages: data.numpages || 0,
    };
  } catch (err) {
    console.error('[pdf] extraction failed for', filePath, (err as Error).message);
    return { text: '', pages: 0 };
  }
}
