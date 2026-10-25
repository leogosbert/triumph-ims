import { catalogueUrl, cataloguePhotoUrl } from "@/lib/growth-tools/catalogue";
import { buildCataloguePdf } from "@/lib/pdf/catalogue";
import type { DocCompany } from "@/lib/pdf/document";
import { loadCatalogue, logoUrl } from "../data";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

async function fetchImage(url: string | null, max = 1_500_000): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!url) return null;
  const type = /\.png(\?|$)/i.test(url) ? "png" : /\.jpe?g(\?|$)/i.test(url) ? "jpg" : null;
  if (!type) return null;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength <= max ? { bytes: buf, type } : null;
  } catch {
    return null;
  }
}

/** The public catalogue as a PDF (same content as the page). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await loadCatalogue(slug);
  if (!c) return new Response("Catalogue not found.", { status: 404 });
  const started = Date.now();
  const photos = new Map<string, { bytes: Uint8Array; type: "png" | "jpg" }>();
  // Photos in small parallel batches, within about 4 seconds (Netlify stops at 10 s).
  const withPhoto = c.products.filter((p) => p.photo_path && /\.(png|jpe?g)$/i.test(p.photo_path)).slice(0, 60);
  for (let i = 0; i < withPhoto.length && Date.now() - started < 4000; i += 6) {
    const batch = withPhoto.slice(i, i + 6);
    const got = await Promise.all(batch.map((p) => fetchImage(cataloguePhotoUrl(p.photo_path))));
    got.forEach((g, k) => g && photos.set(batch[k].id, g));
  }
  const company: DocCompany = {
    name: c.company.name,
    legal_name: c.company.legal_name,
    address: c.company.address,
    phone: c.company.phone,
    email: c.company.email,
    website: c.company.website,
    tin: null,
    vrn: null,
    primary_color: c.company.primary_color ?? "#1c4d9c",
    accent_color: c.company.accent_color ?? "#123a7a",
    bank_details: null,
    document_footer: null,
  };
  const bytes = await buildCataloguePdf({
    company,
    logo: await fetchImage(logoUrl(c.company.logo_path), 800_000),
    currency: c.company.currency,
    headline: c.headline,
    intro: c.intro,
    url: new URL(catalogueUrl(c.slug), req.url).toString(),
    contact: { phone: c.company.phone, email: c.company.email, whatsapp: c.company.whatsapp, address: c.company.address },
    products: c.products,
    photos,
  });
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${`${c.company.name} catalogue`.replace(/[^\w.\- ]+/g, "").trim()}.pdf"`,
      "Cache-Control": "public, max-age=600",
    },
  });
}
