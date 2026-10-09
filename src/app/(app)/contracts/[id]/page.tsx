import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LinkedDocuments } from "@/components/LinkedDocuments";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { contractKindLabel, daysUntil } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { endContract, removeContractPrice, saveContract, setContractPrice } from "../actions";
import { ContractFields } from "../ContractFields";

export const metadata = { title: "Contract" };

type Price = { id: string; unit_price: number; notes: string | null; product: { id: string; name: string; sku: string; unit: string; selling_price: number | null } | null };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeContracts")) redirect("/");
  const { data: k } = await supabase.from("contracts").select("*, client:clients(id, name)").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!k) notFound();
  const edit = can(role, "seeCrm") && !k.cancelled_at;
  const [{ data: priceData }, { data: products }, { data: tenders }] = await Promise.all([
    supabase.from("contract_prices").select("id, unit_price, notes, product:products(id, name, sku, unit, selling_price)").eq("contract_id", id).limit(2000),
    edit ? supabase.from("products").select("id, name, sku").eq("company_id", company.id).eq("active", true).order("name").limit(3000) : Promise.resolve({ data: [] }),
    edit ? supabase.from("tenders").select("id, number, title").eq("company_id", company.id).eq("status", "won").limit(100) : Promise.resolve({ data: [] }),
  ]);
  const prices = ((priceData ?? []) as unknown as Price[]).sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));
  const left = daysUntil(k.end_date) ?? 0;
  const started = (daysUntil(k.start_date) ?? 0) <= 0;
  const state = k.cancelled_at ? tr("Ended early") : left < 0 ? tr("Ended") : !started ? tr("Not started yet") : `${left} ${tr("days left")}`;

  return (
    <>
      <p className="small">
        <Link href="/contracts">{tr("← Contracts")}</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>{k.client?.name}</h1>
      <p style={{ margin: "4px 0" }}>{k.title}</p>
      <p className="muted small">
        {k.number}
        {k.reference && ` · ${k.reference}`} · {tr(contractKindLabel(k.kind))} · {k.currency}
        {k.value_cap !== null && ` · ${tr("value")} ${formatMoney(k.value_cap, k.currency)}`}
        {k.payment_terms && ` · ${k.payment_terms}`}
      </p>
      <p className={!k.cancelled_at && left >= 0 && left <= k.remind_days ? "text-warn" : undefined}>
        {formatDate(k.start_date)} – {formatDate(k.end_date)} · {state}
      </p>
      {k.client && (
        <p className="small">
          <Link href={`/clients/${k.client.id}`}>{tr("Open client")}</Link>
          {k.tender_id && (
            <>
              {" · "}
              <Link href={`/tenders/${k.tender_id}`}>{tr("Tender")}</Link>
            </>
          )}
        </p>
      )}
      <Notice {...notice} />
      {k.cancelled_at && (
        <div className="banner warn small">
          {tr("Ended early:")} {k.cancelled_reason} · {formatDateTime(k.cancelled_at)}
        </div>
      )}

      <section className="card" id="prices">
        <h2>{tr("Agreed prices")}</h2>
        <p className="small muted">{tr("While the contract runs, “Use contract prices” on a draft quotation for this client puts these prices on the matching lines.")}</p>
        {prices.length === 0 ? (
          <p className="muted small">{tr("No prices yet.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="compare">
              <thead>
                <tr>
                  <th>{tr("Product")}</th>
                  <th className="num">{tr("List price")}</th>
                  <th className="num">{tr("Contract price")}</th>
                  <th className="num">{tr("Difference")}</th>
                  {edit && <th />}
                </tr>
              </thead>
              <tbody>
                {prices.map((p) => {
                  const list = Number(p.product?.selling_price ?? 0);
                  const diff = list > 0 ? Math.round(((Number(p.unit_price) - list) / list) * 1000) / 10 : null;
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.product ? <Link href={`/products/${p.product.id}`}>{p.product.name}</Link> : "—"}
                        <div className="small muted">
                          {p.product?.sku} · {p.product?.unit}
                          {p.notes && ` · ${p.notes}`}
                        </div>
                      </td>
                      <td className="num">{list > 0 ? formatMoney(list, company.base_currency) : "—"}</td>
                      <td className="num">
                        <strong>{formatMoney(p.unit_price, k.currency)}</strong>
                      </td>
                      <td className="num">{diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff}%`}</td>
                      {edit && (
                        <td>
                          <form action={removeContractPrice}>
                            <input type="hidden" name="contract_id" value={k.id} />
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className="btn btn-small" aria-label={tr("Remove")} title={tr("Remove")}>
                              ✕
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {edit && (
          <form action={setContractPrice} className="inline-form" style={{ marginTop: 10 }}>
            <input type="hidden" name="contract_id" value={k.id} />
            <select name="product_id" required defaultValue="" aria-label={tr("Product")}>
              <option value="" disabled>
                {tr("Product…")}
              </option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
            <input name="unit_price" type="text" inputMode="decimal" required placeholder={`${tr("Price")} (${k.currency})`} aria-label={tr("Contract price")} />
            <SubmitButton className="btn btn-small btn-primary" pendingText="…">
              {tr("Save price")}
            </SubmitButton>
          </form>
        )}
      </section>

      <LinkedDocuments supabase={supabase} companyId={company.id} field="contract_id" id={k.id} back={`/contracts/${k.id}#documents`} kind="contract" />

      {edit && (
        <>
          <details className="card">
            <summary>{tr("Edit details")}</summary>
            <form action={saveContract} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={k.id} />
              <ContractFields v={k} clients={[]} tenders={(tenders ?? []) as { id: string; number: string; title: string }[]} base={company.base_currency} creating={false} />
              <SubmitButton>{tr("Save")}</SubmitButton>
            </form>
          </details>
          <details className="card">
            <summary>{tr("End the contract early")}</summary>
            <p className="small muted">{tr("The contract stays on record but its prices no longer apply. This cannot be undone: to continue later, add a new contract.")}</p>
            <form action={endContract} className="inline-form">
              <input type="hidden" name="id" value={k.id} />
              <input name="reason" type="text" required maxLength={500} placeholder={tr("Reason")} />
              <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                {tr("End contract")}
              </SubmitButton>
            </form>
          </details>
        </>
      )}
    </>
  );
}
