import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { NotReady } from "@/components/NotReady";
import { PrintButton } from "@/components/reports/PrintButton";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { buildProfitLoss, previousPeriod, readPeriod, toTbRows } from "@/lib/ledger";
import { type SearchParams } from "@/lib/messages";
import { BackLink, GroupRows, PeriodPicker, ResultRow, ledgerContext } from "../shared";

export const metadata = { title: "Profit & loss" };

export default async function LedgerProfitLossPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const period = readPeriod(sp);
  const compare = sp.compare === "1";
  const prev = previousPeriod(period.from, period.to);

  const [cur, last] = await Promise.all([
    supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: period.from, p_to: period.to }),
    compare ? supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: prev.from, p_to: prev.to }) : Promise.resolve(null),
  ]);
  if (isMissingTable(cur.error)) return <NotReady title="Profit & loss" />;
  if (cur.error) throw new Error(cur.error.message);
  if (last?.error) throw new Error(last.error.message);
  const { current: p, previous: q } = buildProfitLoss(toTbRows(cur.data), last ? toTbRows(last.data) : undefined);

  const keep: Record<string, string> = period.key === "custom" ? { from: period.from, to: period.to } : { p: period.key };
  const toggle = new URLSearchParams({ ...keep, ...(compare ? {} : { compare: "1" }) }).toString();
  const extra = compare ? { compare: "1" } : undefined;

  return (
    <>
      <BackLink />
      <h1 className="no-print">{tr("Profit & loss")}</h1>
      <PeriodPicker path="/accounts/profit-loss" period={period} extra={extra} />

      <section className="card report-print">
        <div className="rep-head">
          <p className="rep-company">{company.name}</p>
          <h2>{tr("Profit & loss")}</h2>
          <p className="small">
            {formatDate(period.from)} – {formatDate(period.to)} · {tr("Amounts in")} {base}
          </p>
        </div>
        <div className="rep-actions no-print">
          <Link href={`/accounts/profit-loss?${toggle}`} className="btn btn-small">
            {tr(compare ? "Hide previous period" : "Compare with previous period")}
          </Link>
          <span className="rep-buttons">
            <PrintButton />
          </span>
        </div>
        <div className="scroll-x">
          <table className="compare rep-table">
            <thead>
              <tr>
                <th>{tr("Account")}</th>
                <th className="num">{tr("This period")}</th>
                {compare && (
                  <th className="num">
                    {tr("Previous period")}
                    <br />
                    <span className="small muted">
                      {formatDate(prev.from)} – {formatDate(prev.to)}
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              <GroupRows group={p.sales} currency={base} compare={compare} totalLabel="Total sales" />
              <GroupRows group={p.otherIncome} currency={base} compare={compare} totalLabel="Total other income" hideEmpty />
              <GroupRows group={p.gains} currency={base} compare={compare} totalLabel="Total gains and losses" hideEmpty />
              <ResultRow label="Total income" value={p.totalIncome} compare={q?.totalIncome} currency={base} />
              <GroupRows group={p.costOfSales} currency={base} compare={compare} totalLabel="Total cost of sales" />
              <ResultRow label="Gross profit (sales less cost of sales)" value={p.grossProfit} compare={q?.grossProfit} currency={base} />
              <GroupRows group={p.expenses} currency={base} compare={compare} totalLabel="Total expenses" />
              <ResultRow label={p.netProfit < 0 ? "Net loss" : "Net profit"} value={p.netProfit} compare={q?.netProfit} currency={base} double />
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {tr("Net profit = total income − cost of sales − expenses. Amounts in brackets are negative.")}
        </p>
      </section>
    </>
  );
}
