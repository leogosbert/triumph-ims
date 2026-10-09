/**
 * Shrink a camera photo in the browser before uploading (a receipt photo from a phone is often
 * 4–8 MB; this makes it a few hundred KB so it uploads on a weak signal). PDFs and files the
 * browser cannot read are returned unchanged.
 */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.8): Promise<{ blob: Blob; type: string; ext: string }> {
  if (!file.type.startsWith("image/")) {
    return { blob: file, type: file.type, ext: file.type === "application/pdf" ? "pdf" : "bin" };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read the photo."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size < file.size) return { blob, type: "image/jpeg", ext: "jpg" };
  } catch {
    /* fall through: upload the original */
  } finally {
    URL.revokeObjectURL(url);
  }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  return { blob: file, type: file.type, ext };
}

export const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
