import { shrinkImage } from "@/lib/image";

/** What one AI read may send (Next.js server actions take about 1 MB). */
export const AI_SEND_MAX = 900 * 1024;

/**
 * Makes a photo small enough to send and quick to read: 1280 px on the long side reads receipts and
 * certificates well and keeps the AI call within its time limit; very large photos go down to 1000 px.
 * PDFs go as they are, up to the limit. Browser only.
 */
export async function forAiReading(file: File, what: "receipt" | "document"): Promise<{ blob: Blob; error?: string }> {
  if (file.type === "application/pdf") {
    return file.size > AI_SEND_MAX
      ? { blob: file, error: what === "receipt" ? "This PDF is too large to read. Take a photo of the receipt instead." : "This PDF is too large to read. Take a photo of the page with the details instead." }
      : { blob: file };
  }
  let { blob } = await shrinkImage(file, 1280, 0.75);
  if (blob.size > AI_SEND_MAX * 0.6) ({ blob } = await shrinkImage(file, 1000, 0.65));
  if (blob.size > AI_SEND_MAX) return { blob, error: what === "receipt" ? "The photo is too large to read. Try again closer to the receipt." : "The photo is too large to read. Try a clearer or smaller photo." };
  return { blob };
}
