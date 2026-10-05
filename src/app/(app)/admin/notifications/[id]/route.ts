import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Opening an admin notification (from the list or a phone alert) marks it read and goes to what
 * it is about. The database refuses anyone who is not a verified platform admin.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let link = "/admin/notifications";
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("open_platform_notification", { p_id: id });
    if (typeof data === "string" && data.startsWith("/") && !data.startsWith("//")) link = data;
  }
  return NextResponse.redirect(new URL(link, req.url));
}
