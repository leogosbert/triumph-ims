import { catalogueUrl } from "@/lib/growth-tools/catalogue";
import { qrSvg } from "@/lib/growth-tools/qr";
import { loadCatalogue } from "../data";

export const dynamic = "force-dynamic";

/** QR code (SVG) of the catalogue address, to print on letterheads, stands and vehicles. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await loadCatalogue(slug);
  if (!c) return new Response("Not found.", { status: 404 });
  const svg = qrSvg(new URL(catalogueUrl(c.slug), req.url).toString(), { scale: 10 });
  if (!svg) return new Response("Not found.", { status: 404 });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `inline; filename="${c.slug}-qr.svg"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
