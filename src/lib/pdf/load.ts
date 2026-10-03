import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Fetches the company logo for a PDF (PNG or JPG only). */
export async function loadLogo(supabase: Supabase, path: string | null) {
  const type = path?.toLowerCase().endsWith(".png") ? "png" : /\.jpe?g$/i.test(path ?? "") ? "jpg" : null;
  if (!path || !type) return null;
  try {
    const url = supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: type as "png" | "jpg" };
  } catch {
    return null;
  }
}

export function pdfResponse(bytes: Uint8Array, fileName: string) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName.replace(/[^\w.\- ]+/g, "").trim()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
