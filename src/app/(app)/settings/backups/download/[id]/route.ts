import { requireManager } from "@/lib/context";
import { backupFileName } from "@/lib/backups";
import { withNotice } from "@/lib/messages";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(req: Request, error: string) {
  return Response.redirect(new URL(withNotice("/settings/backups", { error }), req.url), 303);
}

/**
 * /settings/backups/download/<id> — one backup as a JSON file (management only).
 * The database checks the manager (and a recent sign-in when that check exists)
 * and writes the download to the Activity log. The file is exactly the stored copy,
 * so its SHA-256 matches the checksum shown on the Backups page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company } = await requireManager();
  if (!UUID.test(id)) return back(req, "That backup wasn't found.");

  const { data: row } = await supabase.from("company_backups").select("id, taken_at").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!row) return back(req, "That backup wasn't found.");

  const { data, error } = await supabase.rpc("download_company_backup", { p_backup: id });
  if (error || typeof data !== "string") {
    const reauth = error?.hint === "reauth" || error?.code === "28000";
    return back(req, reauth ? "Please confirm it is you first." : "The backup could not be downloaded. Please try again.");
  }
  return new Response(data, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(company.name, (row as { taken_at: string }).taken_at)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
