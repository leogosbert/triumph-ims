import { primeLang, tr } from "@/lib/tr";
import { NotReady } from "@/components/NotReady";
import { PrintButton } from "@/components/reports/PrintButton";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { buildBalanceSheet, isIsoDate, toTbRows } from "@/lib/ledger";
import { type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/services";
import { BackLink, GroupRows, ResultRow, amt, ledgerContext } from "../shared";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const at = isIsoDate(sp.at) ? sp.at : todayTz();

  const res = await supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: null, p_to: at });
  if (isMissingTable(res.error)) return <NotReady title="Balance sheet" />;
  if (res.error) throw new Error(res.error.message);
  const b = buildBalanceSheet(toTbRows(res.data));
  const ok = Math.abs(b.difference) < 1;

  return (
    <>
      <BackLink />
      <h1 className="no-print">{tr("Balance sheet")}</h1>
      <form method="get" action="/accounts/balance-sheet" className="card no-print" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="at">{tr("As at")}</label>
          <input id="at" name="at" type="date" defaultValue={at} required />
        </div>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>

      <section className="card report-print">
        <div className="rep-head">
          <p className="rep-company">{company.name}</p>
          <h2>{tr("Balance sheet")}</h2>
          <p className="small">
            {tr("As at")} {formatDate(at)} · {tr("Amounts in")} {base}
          </p>
        </div>
        <div className="rep-actions no-print">
          <span className={`badge ${ok ? "tone-ok" : "tone-bad"}`}>
            {ok ? tr("Assets = Liabilities + Equity") : `${tr("Does not balance by")} ${amt(b.difference, base)}`}
          </span>
          <span className="rep-buttons">
            <PrintButton />
          </span>
        </div>
        <div className="scroll-x">
          <table className="compare rep-table">
            <tbody>
              <GroupRows group={b.current} currency={base} totalLabel="Total current assets" />
              <GroupRows group={b.fixed} currency={base} totalLabel="Fixed assets at book value" />
              <ResultRow label="Total assets" value={b.totalAssets} currency={base} double />
              <GroupRows group={b.liabilities} currency={base} totalLabel="Total liabilities" />
              <GroupRows group={b.equity} currency={base} totalLabel="Capital and reserves" />
              <tr>
                <td style={{ paddingLeft: 18 }}>
                  {tr("Profit to date")} <span className="small muted">({tr("all income less all expenses")})</span>
                </td>
                <td className={`num${b.profitToDate < 0 ? " text-warn" : ""}`}>{amt(b.profitToDate, base)}</td>
              </tr>
              <ResultRow label="Total equity" value={b.totalEquity} currency={base} />
              <ResultRow label="Total liabilities and equity" value={b.totalLiabilitiesEquity} currency={base} double />
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {tr("Fixed assets are shown at cost less accumulated depreciation. Amounts in brackets are negative.")}
        </p>
      </section>
    </>
  );
}
