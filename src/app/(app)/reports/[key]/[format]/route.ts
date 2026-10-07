import { primeLang, tr } from "@/lib/tr";
import { displayName, getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { recordEvent } from "@/lib/security";
import { todayTz } from "@/lib/sales";
import { findReport } from "@/lib/reports/defs";
import { buildReportPdf, PDF_MAX_ROWS } from "@/lib/reports/pdf";
import { cellText, colLabel, filterOptions, filterText, mayOpen, parseParams, periodText, runReport } from "@/lib/reports/run";
import { buildXlsx } from "@/lib/reports/xlsx";

export const dynamic = "force-dynamic";

/** /reports/<report>/pdf?… and /reports/<report>/xlsx?… : the report as on screen, as a file. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string; format: string }> }) {
  await primeLang();
  const { key, format } = await params;
  const def = findReport(key);
  if (!def || (format !== "pdf" && format !== "xlsx")) return new Response("Not found", { status: 404 });
  const { supabase, company, role, features, profile } = await getAppContext();
  if (!mayOpen(def, role, features)) return new Response("Not allowed", { status: 403 });

  const sp: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(req.url).searchParams) {
    const prev = sp[k];
    sp[k] = prev === undefined ? v : ([] as string[]).concat(prev, v);
  }
  const p = parseParams(def, sp);
  const [res, opts] = await Promise.all([runReport(def, supabase, company, p), filterOptions(def, supabase, company.id)]);
  // Downloads are noted in the person's security history, like other data exports.
  await recordEvent(supabase, "export", company.id);

  const base = company.base_currency;
  const title = tr(def.title);
  const period = `${tr(def.date.label)}: ${periodText(def, p.period, tr)}`;
  const filters = filterText(def, p, opts, tr);
  const prepared = `${tr("Prepared by")} ${displayName(profile)} · ${formatDateTime(new Date().toISOString())}`;
  const headers = res.cols.map((c) => colLabel(c, base, tr));
  const display = (c: Parameters<typeof cellText>[0], v: Parameters<typeof cellText>[1]) => cellText(c, v, tr);
  const slug = `${company.name}-${def.title}`.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  const stamp = todayTz();

  if (format === "xlsx") {
    const bytes = buildXlsx(
      { sheetName: title, title: `${company.name} – ${title}`, lines: [period, filters, prepared].filter(Boolean), headers, cols: res.cols, rows: res.rows, totals: res.totals, totalLabel: tr("Total") },
      display,
    );
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${slug}-${stamp}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const cut = res.rows.length > PDF_MAX_ROWS;
  const bytes = await buildReportPdf(
    {
      company: company.name,
      brand: company.primary_color,
      title,
      lines: [period, filters, `${res.rows.length.toLocaleString("en-GB")} ${tr(res.rows.length === 1 ? "record" : "records")}`, prepared],
      headers,
      cols: res.cols,
      rows: res.rows,
      totals: res.totals,
      totalLabel: tr("Total"),
      footer: `${company.name} · LeMoSp`,
      pageLabel: tr("Page"),
      cutNote: cut ? `${tr("Only the first")} ${PDF_MAX_ROWS.toLocaleString("en-GB")} ${tr("records are printed here. The totals and the Excel file include them all.")}` : null,
      emptyNote: tr("Nothing found for these dates and filters."),
    },
    display,
  );
  return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug}-${stamp}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
