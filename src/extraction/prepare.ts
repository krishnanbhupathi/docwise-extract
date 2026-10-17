import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { InvoiceFile, MediaType } from "./model";

export const MAX_PAGES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;

/** Page count of a PDF; throws if it can't be read. */
export async function pdfPageCount(data: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getPageCount();
}

/**
 * The exact bytes the model sees, shared by the app and the eval so both score
 * the same input. PDFs go as they are. Images are turned upright from their
 * EXIF orientation, capped at 2000 px on the long side (phone photos are
 * larger than the model uses) and re-encoded as JPEG.
 */
export async function prepareForModel(data: Uint8Array, mediaType: MediaType): Promise<InvoiceFile> {
  if (mediaType === "application/pdf") return { data, mediaType };
  const jpeg = await sharp(data)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { data: new Uint8Array(jpeg), mediaType: "image/jpeg" };
}
