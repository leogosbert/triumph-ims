import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { withNotice } from "@/lib/messages";
import { recordEvent, STEP_UP_MESSAGE, stepUpOk } from "@/lib/security";
import { EXPORT_TABLES, fetchAll, toCsv } from "@/lib/exportData";
import { todayTz } from "@/lib/sales";

export const dynamic = "force-dynamic";

/** /settings/export/clients.csv … or /settings/export/all.json (management only). */
export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const { supabase, company } = await requireManager();
  // All the company's data at once: only right after the person confirmed it is them (not needed in the demo).
  if (!(await stepUpOk(supabase, company.id))) redirect(withNotice("/settings/export", { error: STEP_UP_MESSAGE }));
  const stamp = todayTz();
  const slug = company.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");

  if (table === "all.json") {
    const out: Record<string, unknown> = { company, exported_at: new Date().toISOString() };
    for (const t of EXPORT_TABLES) out[t.table] = await fetchAll(supabase, t.table, company.id);
    await recordEvent(supabase, "export", company.id);
    return new Response(JSON.stringify(out, null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-all-data-${stamp}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const name = table.replace(/\.csv$/, "");
  if (!EXPORT_TABLES.some((t) => t.table === name)) return new Response("Unknown table", { status: 404 });
  const rows = await fetchAll(supabase, name, company.id);
  await recordEvent(supabase, "export", company.id);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${name}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
