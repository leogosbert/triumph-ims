import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { SOURCES, monthEnd, sourceLabel, type Journal } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { BackLink, ledgerContext } from "../shared";

export const metadata = { title: "Journals" };

const PAGE = 50;

export default async function JournalsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const source = SOURCES.some((s) => s.key === pick(sp.source)) ? pick(sp.source) : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(pick(sp.month)) ? pick(sp.month) : "";
  const page = Math.max(1, Math.floor(Number(pick(sp.page)) || 1));

  let q = supabase
    .from("gl_journals")
    .select("id, number, entry_date, doc_date, memo, source, source_id, source_ref, reverses, reversed_by, created_by, created_at", { count: "exact" })
    .eq("company_id", company.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (source) q = q.eq("source", source);
  if (month) q = q.gte("entry_date", `${month}-01`).lte("entry_date", monthEnd(`${month}-01`));
  const { data, error, count } = await q;
  if (isMissingTable(error)) return <NotReady title="Journals" />;
  if (error) throw new Error(error.message);
  const journals = (data ?? []) as Journal[];

  const totals = new Map<string, number>();
  if (journals.length) {
    const { data: ld } = await supabase.from("gl_lines").select("journal_id, debit").in("journal_id", journals.map((j) => j.id)).limit(10000);
    for (const l of (ld ?? []) as { journal_id: string; debit: number }[]) totals.set(l.journal_id, (totals.get(l.journal_id) ?? 0) + Number(l.debit));
  }
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number) => {
    const s = new URLSearchParams();
    if (source) s.set("source", source);
    if (month) s.set("month", month);
    if (p > 1) s.set("page", String(p));
    const str = s.toString();
    return `/accounts/journals${str ? `?${str}` : ""}`;
  };

  return (
    <>
      <BackLink />
      <div className="page-head">
        <h1>{tr("Journals")}</h1>
        <Link href="/accounts/journals/new" className="btn btn-primary btn-small">
          {tr("+ Journal")}
        </Link>
      </div>
      <p className="muted small">{tr("Every entry in the books, newest first. Entries from documents are posted for you; journals by hand are for adjustments and opening balances.")}</p>
      <Notice {...notice} />

      <form method="get" action="/accounts/journals" className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="source">{tr("Posted from")}</label>
          <select id="source" name="source" defaultValue={source}>
            <option value="">{tr("Everything")}</option>
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {tr(s.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="month">{tr("Month")}</label>
          <input id="month" name="month" type="month" defaultValue={month} />
        </div>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
        {(source || month) && (
          <Link href="/accounts/journals" className="btn btn-small">
            {tr("Reset")}
          </Link>
        )}
      </form>

      {journals.length === 0 ? (
        <p className="card muted">{tr("No journals found.")}</p>
      ) : (
        <ul className="rec-list">
          {journals.map((j) => (
            <li key={j.id}>
              <Link href={`/accounts/journals/${j.id}`}>
                <div className="main">
                  <div className="title">
                    {j.number} <span className="muted">· {j.memo}</span>
                  </div>
                  <div className="sub">
                    {formatDate(j.entry_date)} · {tr(sourceLabel(j.source))}
                    {j.source_ref && ` · ${j.source_ref}`}{" "}
                    {j.reversed_by && <span className="badge tone-off">{tr("Reversed")}</span>}
                    {j.reverses && <span className="badge tone-warn">{tr("Reversal")}</span>}
                  </div>
                </div>
                <div className="side">{formatMoney(totals.get(j.id) ?? 0, base)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="tabs-row" aria-label={tr("Pages")} style={{ marginTop: 12 }}>
          {page > 1 && <Link href={link(page - 1)}>{tr("← Newer")}</Link>}
          <span className="small muted" style={{ alignSelf: "center" }}>
            {page} / {pages}
          </span>
          {page < pages && <Link href={link(page + 1)}>{tr("Older →")}</Link>}
        </nav>
      )}
    </>
  );
}
