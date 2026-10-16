import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate } from "@/lib/format";
import { DISPOSAL_METHODS, PAID_FROM, assetCategoryLabel, monthLabel, monthlyDepreciation, type FixedAsset } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { todayTz } from "@/lib/services";
import { saveAsset } from "../../actions";
import { BackLink, ledgerContext } from "../../shared";
import { AssetFields } from "../AssetFields";
import { vehicleOptions } from "../vehicles";
import { DisposeForm } from "./DisposeForm";

export const metadata = { title: "Asset" };

type Dep = { month: string; amount: number; journal_id: string | null };

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data } = await supabase.from("fixed_assets").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!data) notFound();
  const a = data as FixedAsset;
  const [{ data: depData }, vehicles, { data: jData }] = await Promise.all([
    supabase.from("fixed_asset_depreciation").select("month, amount, journal_id").eq("asset_id", id).order("month", { ascending: false }),
    vehicleOptions(supabase, company.id),
    supabase.from("gl_journals").select("id, number, source").eq("company_id", company.id).eq("source_id", id).in("source", ["fixed_asset", "asset_disposal"]),
  ]);
  const deps = (depData ?? []) as Dep[];
  const journals = (jData ?? []) as { id: string; number: string; source: string }[];
  const cost = Number(a.cost);
  const accDep = Number(a.accumulated_dep);
  const book = cost - accDep;
  const vehicle = vehicles.find((v) => v.id === a.vehicle_id);
  const active = a.status === "active";
  const left = Math.max(0, cost - Number(a.residual_value) - accDep);

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <tr>
      <td>{tr(label)}</td>
      <td className="num">{children}</td>
    </tr>
  );

  return (
    <>
      <BackLink href="/accounts/assets" label="← Fixed assets" />
      <h1>
        <span className="muted">{a.number}</span> {a.name}
      </h1>
      <p className="muted small">
        {tr(assetCategoryLabel(a.category))}
        {a.serial_no && ` · ${a.serial_no}`}
        {a.location && ` · ${a.location}`}
        {vehicle && (
          <>
            {" · "}
            <Link href={`/fleet/${vehicle.id}`}>{vehicle.plate}</Link>
          </>
        )}{" "}
        {!active && <span className="badge tone-off">{tr("Sold or scrapped")}</span>}
      </p>
      <Notice {...notice} />

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(active ? book : Number(a.disposal_amount ?? 0), base)}</div>
          <div className="l">{tr(active ? "Book value" : "Sold for")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(active && left > 0 ? Math.min(monthlyDepreciation(a), left) : 0, base)}</div>
          <div className="l">{tr("Depreciation a month")}</div>
        </div>
      </div>

      <section className="card">
        <table className="compare rep-table">
          <tbody>
            <Row label="Bought on">{formatDate(a.bought_on)}</Row>
            <Row label="Cost">{formatMoney(cost, base)}</Row>
            <Row label="Value at the end of its life">{formatMoney(Number(a.residual_value), base)}</Row>
            <Row label="Useful life">
              {a.life_months % 12 === 0 ? `${a.life_months / 12} ${tr("years")}` : `${a.life_months} ${tr("months")}`}
            </Row>
            <Row label="Paid from">{tr(PAID_FROM.find((p) => p.key === a.paid_from)?.label ?? a.paid_from)}</Row>
            <Row label="Depreciation so far">{formatMoney(accDep, base)}</Row>
            {a.disposed_on && <Row label="Sold or scrapped on">{formatDate(a.disposed_on)}</Row>}
          </tbody>
        </table>
        {journals.length > 0 && (
          <p className="small">
            {tr("In the books")}:{" "}
            {journals.map((j, i) => (
              <span key={j.id}>
                {i > 0 && " · "}
                <Link href={`/accounts/journals/${j.id}`}>{j.number}</Link>
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="card">
        <h2>{tr("Depreciation by month")}</h2>
        {deps.length === 0 ? (
          <p className="muted small">{tr("No depreciation posted yet. Post it each month from the asset register.")}</p>
        ) : (
          <ul className="rec-list">
            {deps.map((d) => (
              <li key={d.month}>
                {d.journal_id ? (
                  <Link href={`/accounts/journals/${d.journal_id}`}>
                    <div className="main">
                      <div className="title">{monthLabel(d.month, tr)}</div>
                    </div>
                    <div className="side">{formatMoney(Number(d.amount), base)}</div>
                  </Link>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{monthLabel(d.month, tr)}</span>
                    <span>{formatMoney(Number(d.amount), base)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card">
        <summary>{tr("Change the details")}</summary>
        <form action={saveAsset} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={a.id} />
          <AssetFields a={a} vehicles={vehicles} />
          <p className="small muted">{tr("Cost, life and status are fixed once posted. Dispose of the asset and add it again to correct them.")}</p>
          <SubmitButton>{tr("Save")}</SubmitButton>
        </form>
      </details>

      {active && (
        <details className="card">
          <summary>{tr("Sell or scrap")}</summary>
          <div style={{ marginTop: 10 }}>
            <DisposeForm id={a.id} bookValue={book} currency={base} today={todayTz()} methods={DISPOSAL_METHODS} />
          </div>
        </details>
      )}
    </>
  );
}
