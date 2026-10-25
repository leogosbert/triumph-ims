import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * A file a supplier sent through the portal, for our team. Uses the signed-in person's own database
 * session, so the row and storage rules decide (bank letters: management and finance only).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { data: f } = await supabase.from("portal_files").select("storage_path, file_name").eq("id", id).not("stored_at", "is", null).maybeSingle();
  if (!f) return new Response("File not found.", { status: 404 });
  const { data, error } = await supabase.storage.from("portal").createSignedUrl(f.storage_path, 60, { download: f.file_name });
  if (error || !data) return new Response("The file is not available.", { status: 404 });
  return new Response(null, { status: 303, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
}
