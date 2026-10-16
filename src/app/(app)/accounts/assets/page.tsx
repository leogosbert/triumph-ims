import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { assetCategoryLabel, endOfLastMonth, type FixedAsset } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { todayTz } from "@/lib/services";
import { postDepreciation } from "../actions";
import { BackLink, amt, ledgerContext } from "../shared";

export const metadata = { title: "Fixed assets" };

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const disposed = sp.view === "disposed";

  const { data, error } = await supabase
    .from("fixed_assets")
    .select("id, number, name, category, bought_on, cost, residual_value, life_months, accumulated_dep, status, disposed_on, disposal_amount, location")
    .eq("company_id", company.id)
    .eq("status", disposed ? "disposed" : "active")
    .order("number");
  if (isMissingTable(error)) return <NotReady title="Fixed assets" />;
  if (error) throw new Error(error.message);
  const assets = (data ?? []) as FixedAsset[];
  const tot = (f: (a: FixedAsset) => number) => assets.reduce((s, a) => s + f(a), 0);
  const cost = tot((a) => Number(a.cost));
  const dep = tot((a) => Number(a.accumulated_dep));
  const lastMonth = endOfLastMonth(todayTz()).slice(0, 7);

  return (
    <>
      <BackLink />
      <div className="page-head">
        <h1>{tr("Fixed assets")}</h1>
        <Link href="/accounts/assets/new" className="btn btn-primary btn-small">
          {tr("+ Asset")}
        </Link>
      </div>
      <p className="muted small">{tr("Vehicles, machines, computers and furniture the business owns, with their cost spread over the years they are used.")}</p>
      <Notice {...notice} />

      {!disposed && (
        <form action={postDepreciation} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="month">{tr("Post depreciation for")}</label>
            <input id="month" name="month" type="month" required defaultValue={lastMonth} />
          </div>
          <SubmitButton className="btn btn-small" pendingText={tr("Posting…")}>
            {tr("Post depreciation")}
          </SubmitButton>
          <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
            {tr("Once a month for every asset in use. A month already posted is skipped.")}
          </p>
        </form>
      )}

      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/accounts/assets" aria-current={!disposed ? "page" : undefined}>
          {tr("In use")}
        </Link>
        <Link href="/accounts/assets?view=disposed" aria-current={disposed ? "page" : undefined}>
          {tr("Sold or scrapped")}
        </Link>
      </nav>

      {assets.length === 0 ? (
        <p className="card muted">{tr(disposed ? "No assets sold or scrapped." : "No assets yet. Add your vehicles, machines and equipment.")}</p>
      ) : (
        <section className="card">
          <div className="scroll-x">
            <table className="compare rep-table">
              <thead>
                <tr>
                  <th>{tr("Asset")}</th>
                  <th>{tr("Bought on")}</th>
                  <th className="num">{tr("Cost")}</th>
                  <th className="num">{tr("Depreciation so far")}</th>
                  <th className="num">{disposed ? tr("Sold for") : tr("Book value")}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/accounts/assets/${a.id}`}>
                        <span className="muted small">{a.number}</span> {a.name}
                      </Link>
                      <div className="small muted">
                        {tr(assetCategoryLabel(a.category))}
                        {a.location && ` · ${a.location}`}
                        {a.disposed_on && ` · ${formatDate(a.disposed_on)}`}
                      </div>
                    </td>
                    <td>{formatDate(a.bought_on)}</td>
                    <td className="num">{amt(Number(a.cost), base)}</td>
                    <td className="num">{amt(Number(a.accumulated_dep), base)}</td>
                    <td className="num">{amt(disposed ? Number(a.disposal_amount ?? 0) : Number(a.cost) - Number(a.accumulated_dep), base)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    {tr("Total")} ({assets.length})
                  </td>
                  <td></td>
                  <td className="num">{amt(cost, base)}</td>
                  <td className="num">{amt(dep, base)}</td>
                  <td className="num">{amt(disposed ? tot((a) => Number(a.disposal_amount ?? 0)) : cost - dep, base)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!disposed && (
            <p className="small muted">
              {tr("Book value")}: {formatMoney(cost - dep, base)}
            </p>
          )}
        </section>
      )}
    </>
  );
}
