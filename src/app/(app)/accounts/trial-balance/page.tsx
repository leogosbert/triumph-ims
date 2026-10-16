import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { NotReady } from "@/components/NotReady";
import { PrintButton } from "@/components/reports/PrintButton";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { isIsoDate, toTbRows, yearStart } from "@/lib/ledger";
import { type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/services";
import { BackLink, amt, drCr, ledgerContext } from "../shared";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: SearchParams }) {
  const lang = await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const today = todayTz();
  const to = isIsoDate(sp.to) ? sp.to : today;
  const from = isIsoDate(sp.from) && sp.from <= to ? sp.from : yearStart(to);
  const moves = sp.moves === "1";
  const w = drCr(lang);

  const res = await supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: from, p_to: to });
  if (isMissingTable(res.error)) return <NotReady title="Trial balance" />;
  if (res.error) throw new Error(res.error.message);
  const rows = toTbRows(res.data).filter((r) => r.opening || r.debit || r.credit || r.closing);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const totDr = sum((r) => Math.max(r.closing, 0));
  const totCr = sum((r) => Math.max(-r.closing, 0));
  const q = new URLSearchParams({ from, to }).toString();

  return (
    <>
      <BackLink />
      <h1 className="no-print">{tr("Trial balance")}</h1>
      <form method="get" action="/accounts/trial-balance" className="card no-print">
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="from">{tr("From")}</label>
            <input id="from" name="from" type="date" defaultValue={from} required />
          </div>
          <div className="field">
            <label htmlFor="to">{tr("To")}</label>
            <input id="to" name="to" type="date" defaultValue={to} required />
          </div>
        </div>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
          <input type="checkbox" name="moves" value="1" defaultChecked={moves} /> {tr("Show the movement in the period")}
        </label>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>

      <section className="card report-print">
        <div className="rep-head">
          <p className="rep-company">{company.name}</p>
          <h2>{tr("Trial balance")}</h2>
          <p className="small">
            {moves ? `${formatDate(from)} – ${formatDate(to)}` : `${tr("As at")} ${formatDate(to)}`} · {tr("Amounts in")} {base}
          </p>
        </div>
        <div className="rep-actions no-print">
          <span className={`badge ${Math.abs(totDr - totCr) < 0.01 ? "tone-ok" : "tone-bad"}`}>
            {Math.abs(totDr - totCr) < 0.01 ? tr("Debits equal credits") : tr("Debits and credits differ")}
          </span>
          <span className="rep-buttons">
            <PrintButton />
            <a className="btn btn-small btn-primary" href={`/accounts/trial-balance/csv?${q}`} download>
              ⬇ {tr("CSV")}
            </a>
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="muted">{tr("Nothing in the books yet.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="compare rep-table">
              <thead>
                <tr>
                  <th>{tr("Account")}</th>
                  {moves && <th className="num">{tr("Opening")}</th>}
                  {moves && <th className="num">{`${w.dr} (${tr("period")})`}</th>}
                  {moves && <th className="num">{`${w.cr} (${tr("period")})`}</th>}
                  <th className="num">{w.dr}</th>
                  <th className="num">{w.cr}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.account_id}>
                    <td>
                      <Link href={`/accounts/ledger/${r.account_id}?${q}`}>
                        <span className="muted small">{r.code}</span> {r.name}
                      </Link>
                    </td>
                    {moves && <td className="num">{amt(r.opening, base)}</td>}
                    {moves && <td className="num">{amt(r.debit, base)}</td>}
                    {moves && <td className="num">{amt(r.credit, base)}</td>}
                    <td className="num">{r.closing > 0 ? amt(r.closing, base) : ""}</td>
                    <td className="num">{r.closing < 0 ? amt(-r.closing, base) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{tr("Total")}</td>
                  {moves && <td className="num">{amt(sum((r) => r.opening), base)}</td>}
                  {moves && <td className="num">{amt(sum((r) => r.debit), base)}</td>}
                  {moves && <td className="num">{amt(sum((r) => r.credit), base)}</td>}
                  <td className="num">{amt(totDr, base)}</td>
                  <td className="num">{amt(totCr, base)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {moves && <p className="small muted">{tr("Opening is the balance before the first day (debit positive, credit in brackets).")}</p>}
      </section>
    </>
  );
}
