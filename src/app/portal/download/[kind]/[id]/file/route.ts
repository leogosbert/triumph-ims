import { clientIp, portalDb, portalRpc, PortalError, readSession } from "@/lib/portal/server";

export const dynamic = "force-dynamic";

const KINDS = new Set(["document", "file", "pod_signature", "pod_photo"]);
const BUCKETS = new Set(["documents", "portal", "pod"]);

type Opened = { bucket: string; path: string; file_name?: string; name?: string };

/**
 * A shared document, a file the supplier sent, or the signature or photo taken on delivery.
 * portal_open() checks access and logs the download; the person gets a link valid for 60 seconds.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!KINDS.has(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  const { session, account } = await readSession();
  if (!session || !account) return Response.redirect(new URL("/portal/login", req.url), 303);
  const db = portalDb();
  if (!db) return new Response("The portal is not set up yet.", { status: 503 });

  let o: Opened;
  try {
    o = await portalRpc<Opened>("portal_open", { p_session: session, p_account: account, p_kind: kind, p_id: id, p_ip: await clientIp() });
  } catch (e) {
    if (e instanceof PortalError && e.code === "28000") return Response.redirect(new URL("/portal/login?expired=1", req.url), 303);
    return new Response("Not found.", { status: 404 });
  }
  if (!BUCKETS.has(o.bucket) || !o.path) return new Response("Not found.", { status: 404 });
  const name = (o.file_name || o.name || "file").replace(/[\r\n"]/g, "");
  const { data, error } = await db.storage.from(o.bucket).createSignedUrl(o.path, 60, kind.startsWith("pod_") ? undefined : { download: name });
  if (error || !data) return new Response("The file is not available.", { status: 404 });
  return new Response(null, { status: 303, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
}
