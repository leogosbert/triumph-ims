import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Opening a notification marks it read and goes to what it is about. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("link")
    .maybeSingle();
  const link = data?.link && data.link.startsWith("/") && !data.link.startsWith("//") ? data.link : "/notifications";
  return NextResponse.redirect(new URL(link, req.url));
}
