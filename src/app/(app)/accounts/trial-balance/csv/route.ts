import type { NextRequest } from "next/server";
import { getAppContext } from "@/lib/context";
import { csvCell, isIsoDate, toTbRows, typeLabel, yearStart } from "@/lib/ledger";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Trial balance as a CSV file for the accountant (opening, movement and closing per account). */
export async function GET(req: NextRequest) {
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "seeLedger")) return new Response("Only management or finance can see the books.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const toQ = sp.get("to");
  const fromQ = sp.get("from");
  const to = isIsoDate(toQ) ? toQ : todayTz();
  const from = isIsoDate(fromQ) && fromQ <= to ? fromQ : yearStart(to);
  const { data, error } = await supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: from, p_to: to });
  if (error) return new Response(error.message, { status: 400 });
  const rows = toTbRows(data).filter((r) => r.opening || r.debit || r.credit || r.closing);
  const head = ["Code", "Account", "Type", "Opening", "Debit in period", "Credit in period", "Closing", "Debit balance", "Credit balance"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push(
      [r.code, r.name, typeLabel(r.type), r.opening.toFixed(2), r.debit.toFixed(2), r.credit.toFixed(2), r.closing.toFixed(2),
        r.closing > 0 ? r.closing.toFixed(2) : "", r.closing < 0 ? (-r.closing).toFixed(2) : ""]
        .map(csvCell)
        .join(","),
    );
  }
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0).toFixed(2);
  lines.push(
    ["", "Total", "", sum((r) => r.opening), sum((r) => r.debit), sum((r) => r.credit), sum((r) => r.closing),
      sum((r) => Math.max(r.closing, 0)), sum((r) => Math.max(-r.closing, 0))].map(csvCell).join(","),
  );
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trial-balance-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
