import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { ProductLineFields } from "@/components/ProductPicker";
import { SharePdfButton } from "@/components/SharePdfButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { productOptions } from "@/lib/options";
import { companyPeople, namesFor } from "@/lib/people";
import { can, ROLE_LABELS, type Role } from "@/lib/roles";
import { quoteNo, StatusBadge } from "@/lib/sales";
import { DELIVERY_STATUS, fmtQty, storeOptions } from "@/lib/stock";
import {
  addDeliveryLine,
  cancelDelivery,
  dispatchDelivery,
  failDelivery,
  removeDeliveryLine,
  saveDelivery,
  updateDeliveryLine,
} from "../actions";
import { newInvoice } from "../../invoices/actions";

export const metadata = { title: "Delivery" };

type Line = { id: string; line_no: number; description: string; quantity: number; unit: string; product_id: string | null; product: { sku: string } | null };

export default async function DeliveryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (role === "driver") redirect(`/driver`);
  if (!can(role, "seeDeliveries")) redirect("/");

  const { data: d } = await supabase
    .from("deliveries")
    .select("*, client:clients(id, name), store:warehouses(id, name), quotation:quotations(id, number, revision, client_ref)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!d) notFound();

  const edit = can(role, "editDeliveries");
  const isDraft = d.status === "draft";
  const assignable = edit && ["draft", "dispatched"].includes(d.status);
  const [{ data: lineData }, people, stores, products, names, { data: moves }] = await Promise.all([
    supabase.from("delivery_lines").select("id, line_no, description, quantity, unit, product_id, product:products(sku)").eq("delivery_id", id).order("line_no"),
    assignable ? companyPeople(supabase, company.id) : Promise.resolve([]),
    edit && isDraft ? storeOptions(supabase, company.id) : Promise.resolve([]),
    edit && isDraft ? productOptions(supabase, company.id) : Promise.resolve([]),
    namesFor(supabase, [d.driver_id, d.pod_recorded_by, d.created_by]),
    d.status !== "draft"
      ? supabase.from("stock_movements").select("product_id, batch_no, quantity").eq("delivery_id", id).eq("kind", "dispatch")
      : Promise.resolve({ data: [] }),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  // Fleet plates to pick from (empty before the Stage 15 SQL or for roles that don't see the fleet).
  const { data: fleet } = assignable
    ? await supabase.from("vehicles").select("plate, name").eq("company_id", company.id).eq("active", true).order("plate")
    : { data: null };
  const plates = (fleet ?? []) as { plate: string; name: string | null }[];
  const { data: dnInvoice } =
    d.status === "delivered" && can(role, "seeInvoices")
      ? await supabase.from("invoices").select("id, number").eq("delivery_id", id).neq("status", "cancelled").maybeSingle()
      : { data: null };
  const batches = new Map<string, string[]>();
  for (const m of (moves ?? []) as { product_id: string; batch_no: string; quantity: number }[]) {
    if (!m.batch_no) continue;
    batches.set(m.product_id, [...(batches.get(m.product_id) ?? []), `${m.batch_no} (${fmtQty(-m.quantity)})`]);
  }

  let signatureUrl: string | null = null;
  let photoUrl: string | null = null;
  if (d.signature_path) signatureUrl = (await supabase.storage.from("pod").createSignedUrl(d.signature_path, 3600)).data?.signedUrl ?? null;
  if (d.photo_path) photoUrl = (await supabase.storage.from("pod").createSignedUrl(d.photo_path, 3600)).data?.signedUrl ?? null;
  const pdfHref = `/deliveries/${d.id}/pdf`;
  const drivers = people.filter((p) => ["driver", "warehouse", "management"].includes(p.role));

  return (
    <>
      <p className="small">
        <Link href="/deliveries">{tr("← Deliveries")}</Link>
        {d.quotation && can(role, "seeSales") && (
          <>
            {" · "}
            <Link href={`/quotations/${d.quotation.id}`}>{quoteNo(d.quotation)}</Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{d.client?.name}</h1>
        <StatusBadge map={DELIVERY_STATUS} status={d.status} />
      </div>
      <p className="muted small">
        {d.number}{" "}{tr("· from")}{" "}{d.store?.name}
        {d.planned_date && <>{" "}{tr("· planned")}{" "}{formatDate(d.planned_date)}</>}
        {d.driver_id && <>{" "}{tr("· driver")}{" "}{names.get(d.driver_id)}</>}
        {d.vehicle && <> · {d.vehicle}</>}
      </p>
      <Notice {...notice} />

      {d.status === "delivered" && can(role, "seeInvoices") && (
        <div className="banner ok small">
          {dnInvoice ? (
            <>{tr("Invoiced:")}{" "}<Link href={`/invoices/${dnInvoice.id}`}>{dnInvoice.number || tr("draft invoice")}</Link>
            </>
          ) : can(role, "editInvoices") ? (
            <form action={newInvoice} className="row">
              <input type="hidden" name="delivery_id" value={d.id} />
              <input type="hidden" name="back" value={`/deliveries/${d.id}`} />
              <span>{tr("Delivered and ready to invoice.")}</span>
              <SubmitButton className="btn btn-small btn-primary" pendingText="…">{tr("Create invoice")}</SubmitButton>
            </form>
          ) : (
            tr("Delivered, not invoiced yet.")
          )}
        </div>
      )}

      {d.status === "delivered" && (
        <section className="card" style={{ borderColor: "#b9e0cc" }}>
          <h2>{tr("Proof of delivery")}</h2>
          <dl className="kv">
            <dt>{tr("Received by")}</dt>
            <dd>
              <strong>{d.received_by_name}</strong>
            </dd>
            <dt>{tr("When")}</dt>
            <dd>{formatDateTime(d.delivered_at)}</dd>
            {d.gps_lat != null && (
              <>
                <dt>{tr("Where")}</dt>
                <dd>
                  <a href={`https://www.google.com/maps?q=${d.gps_lat},${d.gps_lng}`} target="_blank" rel="noopener">
                    {Number(d.gps_lat).toFixed(5)}, {Number(d.gps_lng).toFixed(5)}{" "}{tr("(map)")}</a>
                </dd>
              </>
            )}
            {d.pod_notes && (
              <>
                <dt>{tr("Remarks")}</dt>
                <dd>{d.pod_notes}</dd>
              </>
            )}
            {d.pod_recorded_by && (
              <>
                <dt>{tr("Recorded by")}</dt>
                <dd>{names.get(d.pod_recorded_by)}</dd>
              </>
            )}
          </dl>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            {signatureUrl && (
              <div>
                <div className="muted small">{tr("Signature")}</div>
                <img src={signatureUrl} alt={tr("Signature")} style={{ maxWidth: "100%", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
              </div>
            )}
            {photoUrl && (
              <div>
                <div className="muted small">{tr("Photo")}</div>
                <a href={photoUrl} target="_blank" rel="noopener">
                  <img src={photoUrl} alt={tr("Delivery photo")} style={{ maxWidth: "100%", borderRadius: 8 }} />
                </a>
              </div>
            )}
          </div>
        </section>
      )}
      {d.status === "failed" && <div className="banner bad">{tr("Delivery failed:")}{" "}{d.failed_reason}{tr(". The goods were returned to stock.")}</div>}

      <div className="actions-bar">
        {lines.length > 0 && d.status !== "cancelled" && (
          <>
            <SharePdfButton href={pdfHref} fileName={`${d.number} ${d.client?.name ?? ""}.pdf`.replace(/[^\w.\- ]+/g, "")} title={`Delivery note ${d.number}`} />
            <a className="btn" href={pdfHref} target="_blank" rel="noopener">
              {d.status === "delivered" ? tr("Signed delivery note") : tr("Print delivery note")}
            </a>
          </>
        )}
      </div>

      {isDraft && can(role, "dispatch") && lines.length > 0 && (
        <form action={dispatchDelivery} className="card">
          <input type="hidden" name="id" value={d.id} />
          <p className="small muted" style={{ marginTop: 0 }}>{tr("Dispatching takes the goods out of")}{" "}{d.store?.name}{" "}{tr("(oldest expiry first) and sends the delivery to the driver's phone.")}</p>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Dispatching…")}>{tr("Dispatch now")}</SubmitButton>
        </form>
      )}

      {d.status === "dispatched" && can(role, "dispatch") && (
        <section className="card">
          <h2>{tr("On the way")}</h2>
          <Link href={`/driver?d=${d.id}`} className="btn btn-primary btn-block">{tr("Record proof of delivery")}</Link>
          <form action={failDelivery} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={d.id} />
            <div className="field">
              <label htmlFor="reason">{tr("Delivery failed? Why")}</label>
              <input id="reason" name="reason" type="text" placeholder={tr("e.g. site closed, client refused")} />
            </div>
            <SubmitButton className="btn btn-danger" pendingText={tr("Saving…")}>{tr("Record failed delivery")}</SubmitButton>
          </form>
        </section>
      )}

      <section className="card" id="lines">
        <h2>{tr("Items (")}{lines.length})</h2>
        {lines.length === 0 && <p className="muted small">{tr("No items yet.")}</p>}
        <ul className="lines">
          {lines.map((l) => (
            <li key={l.id}>
              <div className="line-head">
                <div>
                  <div className="desc">
                    {l.line_no}. {l.description}
                  </div>
                  <div className="muted small">
                    {l.product ? l.product.sku : tr("not a catalogue item")}
                    {l.product_id && batches.get(l.product_id) ? ` · batch ${batches.get(l.product_id)!.join(", ")}` : ""}
                  </div>
                </div>
                <strong>
                  {fmtQty(l.quantity)} {l.unit}
                </strong>
              </div>
              {edit && isDraft && (
                <div className="row" style={{ alignItems: "end" }}>
                  <form action={updateDeliveryLine} className="inline-form">
                    <input type="hidden" name="delivery_id" value={d.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <input name="quantity" type="text" inputMode="decimal" defaultValue={fmtQty(l.quantity)} aria-label={tr("Quantity")} style={{ width: 90 }} />
                    <SubmitButton className="btn btn-small" pendingText="…">{tr("Update")}</SubmitButton>
                  </form>
                  <form action={removeDeliveryLine}>
                    <input type="hidden" name="delivery_id" value={d.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
        {edit && isDraft && (
          <details style={{ marginTop: 12 }} open={lines.length === 0}>
            <summary>
              <strong>{tr("+ Add an item")}</strong>
            </summary>
            <form action={addDeliveryLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="delivery_id" value={d.id} />
              <ProductLineFields products={products} />
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add item")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {assignable && (
        <section className="card" id="details">
          <h2>{isDraft ? tr("Details") : tr("Driver and vehicle")}</h2>
          <form action={saveDelivery}>
            <input type="hidden" name="id" value={d.id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="driver_id">{tr("Driver")}</label>
                <select id="driver_id" name="driver_id" defaultValue={d.driver_id ?? ""}>
                  <option value="">{tr("Not assigned")}</option>
                  {drivers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({ROLE_LABELS[p.role as Role] ?? p.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="vehicle">{tr("Vehicle")}</label>
                <input id="vehicle" name="vehicle" type="text" defaultValue={d.vehicle ?? ""} placeholder={tr("e.g. T 123 ABC")} list="fleet-plates" />
                {plates.length > 0 && (
                  <datalist id="fleet-plates">
                    {plates.map((v) => (
                      <option key={v.plate} value={v.plate}>
                        {v.name ?? ""}
                      </option>
                    ))}
                  </datalist>
                )}
              </div>
              <div className="field">
                <label htmlFor="planned_date">{tr("Planned date")}</label>
                <input id="planned_date" name="planned_date" type="date" defaultValue={d.planned_date ?? ""} />
              </div>
              {isDraft && (
                <>
                  <div className="field">
                    <label htmlFor="warehouse_id">{tr("From store")}</label>
                    <select id="warehouse_id" name="warehouse_id" defaultValue={d.warehouse_id}>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="delivery_site">{tr("Delivery site / address")}</label>
                    <textarea id="delivery_site" name="delivery_site" defaultValue={d.delivery_site ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="contact_name">{tr("Contact at site")}</label>
                    <input id="contact_name" name="contact_name" type="text" defaultValue={d.contact_name ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="contact_phone">{tr("Contact phone")}</label>
                    <input id="contact_phone" name="contact_phone" type="tel" defaultValue={d.contact_phone ?? ""} />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="notes">{tr("Notes for the driver and client")}</label>
                    <textarea id="notes" name="notes" defaultValue={d.notes ?? ""} placeholder={tr("Printed on the delivery note")} />
                  </div>
                </>
              )}
            </div>
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </section>
      )}

      {edit && isDraft && (
        <form action={cancelDelivery}>
          <input type="hidden" name="id" value={d.id} />
          <SubmitButton className="btn btn-block btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel delivery note")}</SubmitButton>
        </form>
      )}
    </>
  );
}
