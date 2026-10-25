import { SLUG_RE } from "@/lib/growth-tools/catalogue";
import { inboxAdmin } from "@/lib/inbox/server";

export const dynamic = "force-dynamic";

/**
 * A data sheet, SDS, CoA or certificate that management marked public: a short-lived link to the
 * file. Any other document (not public, archived, or of a product no longer shown) is "not found".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; doc: string }> }) {
  const { slug, doc } = await params;
  if (!SLUG_RE.test(slug) || !/^[0-9a-f-]{36}$/i.test(doc)) return new Response("Not found.", { status: 404 });
  const admin = inboxAdmin();
  if (!admin) return new Response("Not available.", { status: 503 });
  const { data } = await admin.rpc("catalogue_public_document", { p_slug: slug, p_document: doc });
  const d = data as { file_path: string; file_name: string | null; title: string } | null;
  if (!d?.file_path) return new Response("Not found.", { status: 404 });
  const { data: signed, error } = await admin.storage.from("documents").createSignedUrl(d.file_path, 120, { download: d.file_name ?? undefined });
  if (error || !signed?.signedUrl) return new Response("Not available.", { status: 503 });
  return new Response(null, { status: 302, headers: { Location: signed.signedUrl, "Cache-Control": "no-store" } });
}
