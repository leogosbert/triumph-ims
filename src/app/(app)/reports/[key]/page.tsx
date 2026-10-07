import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PeriodFields } from "@/components/reports/PeriodFields";
import { PrintButton } from "@/components/reports/PrintButton";
import { SaveReportButton } from "@/components/reports/SavedReports";
import { displayName, getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { type SearchParams } from "@/lib/messages";
import { PRESETS } from "@/lib/reports/dates";
import { findReport, MAX_ROWS, type FilterKey } from "@/lib/reports/defs";
import { cellText, colLabel, FILTER_LABELS, filterOptions, filterText, mayOpen, parseParams, periodText, runReport, toQuery } from "@/lib/reports/run";

export const metadata = { title: "Report" };

/** Rows shown on screen (and printed); the PDF and Excel files have them all. */
const SCREEN_ROWS = 500;

/** For a stock report "at the end of" a day, only these choices make sense. */
const AS_AT = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_week", label: "End of last week" },
  { key: "last_month", label: "End of last month" },
  { key: "last_quarter", label: "End of last quarter" },
  { key: "last_year", label: "End of last year" },
  { key: "custom", label: "Choose a date" },
];

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { key } = await params;
  const def = findReport(key);
  if (!def) notFound();
  const { supabase, company, role, features, profile } = await getAppContext();
  if (!mayOpen(def, role, features)) redirect("/reports");

  const sp = (await searchParams) ?? {};
  const p = parseParams(def, sp);
  const [res, opts] = await Promise.all([runReport(def, supabase, company, p), filterOptions(def, supabase, company.id)]);
  const query = toQuery(def, p);
  const base = company.base_currency;
  const period = periodText(def, p.period, tr);
  const filters = filterText(def, p, opts, tr);
  const shown = res.rows.slice(0, SCREEN_ROWS);
  const customised = Boolean(sp.cols || sp.sort);
  const sortHref = (k: string) => {
    const u = new URLSearchParams(query);
    u.set("sort", k);
    u.set("dir", p.sort === k && p.dir === "asc" ? "desc" : "asc");
    return `/reports/${def.key}?${u.toString()}`;
  };
  const numeric = (t: string) => t === "money" || t === "qty" || t === "int" || t === "percent";
  const filterBox = (k: FilterKey) => {
    if (k === "status") {
      if (!def.statuses) return null;
      return (
        <label key={k} className="rep-field">
          <span>{tr("Status")}</span>
          <select name="status" defaultValue={p.filters.status ?? ""}>
            <option value="">{tr(def.defaultStatuses ? (def.defaultLabel ?? "Default") : "All")}</option>
            {def.defaultStatuses && <option value="*">{tr("All")}</option>}
            {Object.entries(def.statuses).map(([v, l]) => (
              <option key={v} value={v}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>
      );
    }
    const list = opts[k] ?? [];
    if (list.length === 0) return null;
    return (
      <label key={k} className="rep-field">
        <span>{tr(FILTER_LABELS[k])}</span>
        <select name={k} defaultValue={p.filters[k] ?? ""}>
          <option value="">{tr("All")}</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {k === "method" || k === "kind" ? tr(o.label) : o.label}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <>
      <p className="small no-print">
        <Link href="/reports">{tr("← Reports")}</Link>
      </p>
      <h1 className="no-print">{tr(def.title)}</h1>
      <p className="muted small no-print">{tr(def.description)}</p>

      <form className="card rep-form no-print" method="get" action={`/reports/${def.key}`}>
        <PeriodFields
          options={def.date.asAt ? AS_AT : PRESETS.map((x) => ({ key: x.key, label: x.label }))}
          preset={p.period.preset}
          from={p.period.from ?? ""}
          to={p.period.to ?? ""}
          label={def.date.label}
          asAt={Boolean(def.date.asAt)}
        />
        <div className="rep-filters">
          {def.filters.map(filterBox)}
          <label className="rep-field">
            <span>{tr("Contains text")}</span>
            <input type="search" name="q" defaultValue={p.q} placeholder={tr("Name, number, reference…")} />
          </label>
        </div>
        <details className="rep-custom" open={customised}>
          <summary>{tr("Customise: columns and order")}</summary>
          <fieldset className="rep-cols">
            <legend className="small muted">{tr("Columns to show")}</legend>
            {def.cols.map((c) => (
              <label key={c.key} className="check">
                <input type="checkbox" name="cols" value={c.key} defaultChecked={p.cols.includes(c.key)} /> {colLabel(c, base, tr)}
              </label>
            ))}
          </fieldset>
          <div className="rep-filters">
            <label className="rep-field">
              <span>{tr("Sort by")}</span>
              <select name="sort" defaultValue={p.sort}>
                {def.cols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {colLabel(c, base, tr)}
                  </option>
                ))}
              </select>
            </label>
            <label className="rep-field">
              <span>{tr("Order")}</span>
              <select name="dir" defaultValue={p.dir}>
                <option value="asc">{tr("A → Z, smallest first, oldest first")}</option>
                <option value="desc">{tr("Z → A, largest first, newest first")}</option>
              </select>
            </label>
          </div>
        </details>
        <div className="rep-submit">
          <button className="btn btn-primary" type="submit">
            {tr("Show report")}
          </button>
          <Link className="btn" href={`/reports/${def.key}`}>
            {tr("Reset")}
          </Link>
        </div>
      </form>

      <section className="card report-print">
        <div className="rep-head">
          <p className="rep-company">{company.name}</p>
          <h2>{tr(def.title)}</h2>
          <p className="small">
            <strong>{tr(def.date.label)}:</strong> {period}
          </p>
          {filters && <p className="small muted">{filters}</p>}
          <p className="small muted">
            {tr("Prepared by")} {displayName(profile)} · {formatDateTime(new Date().toISOString())}
          </p>
        </div>

        <div className="rep-actions no-print">
          <span className="small">
            <strong>{res.rows.length.toLocaleString("en-GB")}</strong> {tr(res.rows.length === 1 ? "record" : "records")}
          </span>
          <span className="rep-buttons">
            <PrintButton />
            <a className="btn btn-small" href={`/reports/${def.key}/pdf?${query}`} target="_blank" rel="noopener">
              ⬇ {tr("PDF")}
            </a>
            <a className="btn btn-small btn-primary" href={`/reports/${def.key}/xlsx?${query}`} download>
              ⬇ {tr("Excel")}
            </a>
            <SaveReportButton company={company.id} href={`/reports/${def.key}?${query}`} suggested={`${tr(def.title)} · ${period}`} />
          </span>
        </div>

        {res.capped && (
          <p className="notice small">
            {tr("This report reached the limit of")} {MAX_ROWS.toLocaleString("en-GB")} {tr("records, so it may be incomplete. Choose a shorter period or add a filter.")}
          </p>
        )}

        {res.rows.length === 0 ? (
          <p className="muted">{tr("Nothing found for these dates and filters.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="compare rep-table">
              <thead>
                <tr>
                  {res.cols.map((c) => (
                    <th key={c.key} className={numeric(c.type) ? "num" : undefined} aria-sort={p.sort === c.key ? (p.dir === "asc" ? "ascending" : "descending") : undefined}>
                      <Link href={sortHref(c.key)} className="rep-sort" scroll={false}>
                        {colLabel(c, base, tr)}
                        {p.sort === c.key ? (p.dir === "asc" ? " ▲" : " ▼") : ""}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    {res.cols.map((c) => (
                      <td key={c.key} className={numeric(c.type) ? "num" : undefined}>
                        {cellText(c, r[c.key], tr)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {res.totals && (
                <tfoot>
                  <tr>
                    {res.cols.map((c, i) => (
                      <td key={c.key} className={numeric(c.type) ? "num" : undefined}>
                        {c.key in res.totals! ? cellText(c, res.totals![c.key], tr) : i === 0 ? tr("Total") : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {res.rows.length > SCREEN_ROWS && (
          <p className="small muted">
            {tr("Showing the first")} {SCREEN_ROWS} {tr("of")} {res.rows.length.toLocaleString("en-GB")}. {tr("The totals, the PDF and the Excel file include them all.")}
          </p>
        )}
      </section>
    </>
  );
}
