import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { fmtQty, storeOptions } from "@/lib/stock";
import { receiveGoods } from "../../../stock/actions";

export const metadata = { title: "Receive goods" };

type Line = { id: string; line_no: number; description: string; quantity: number; received_qty: number; unit: string; product_id: string | null };

export default async function ReceivePoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "receiveGoods")) redirect(`/purchase-orders/${id}`);
  const [{ data: po }, { data: lineData }, stores] = await Promise.all([
    supabase.from("purchase_orders").select("id, number, status, supplier:suppliers(name)").eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase.from("po_lines").select("id, line_no, description, quantity, received_qty, unit, product_id").eq("po_id", id).order("line_no"),
    storeOptions(supabase, company.id),
  ]);
  if (!po) notFound();
  const lines = ((lineData ?? []) as Line[]).filter((l) => Number(l.quantity) > Number(l.received_qty));
  const open = ["approved", "sent", "confirmed", "partially_received"].includes(po.status);
  const supplier = (po as unknown as { supplier: { name: string } | null }).supplier;

  return (
    <>
      <p className="small">
        <Link href={`/purchase-orders/${id}`}>← {po.number}</Link>
      </p>
      <h1>Receive from {supplier?.name}</h1>
      <Notice {...notice} />
      {!open || lines.length === 0 ? (
        <p className="card muted">Nothing left to receive on this purchase order.</p>
      ) : (
        <form action={receiveGoods}>
          <input type="hidden" name="po_id" value={id} />
          <section className="card">
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="warehouse_id">Into store</label>
                <select id="warehouse_id" name="warehouse_id" required>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="received_on">Received on</label>
                <input id="received_on" name="received_on" type="date" defaultValue={todayTz()} />
              </div>
              <div className="field">
                <label htmlFor="supplier_dn">Supplier&apos;s delivery note no.</label>
                <input id="supplier_dn" name="supplier_dn" type="text" />
              </div>
              <div className="field">
                <label htmlFor="notes">Notes</label>
                <input id="notes" name="notes" type="text" placeholder="e.g. 2 cartons wet" />
              </div>
            </div>
          </section>
          <section className="card">
            <h2>What arrived</h2>
            <p className="muted small">Enter the quantity received now (leave 0 for items that didn&apos;t come). Damaged items are recorded but not added to stock.</p>
            <ul className="lines">
              {lines.map((l) => {
                const open = Number(l.quantity) - Number(l.received_qty);
                return (
                  <li key={l.id}>
                    <div className="desc">
                      {l.line_no}. {l.description}
                    </div>
                    <div className="muted small">
                      Ordered {fmtQty(l.quantity)} {l.unit} · already received {fmtQty(l.received_qty)} · to come {fmtQty(open)}
                      {!l.product_id && " · not a catalogue item (no stock kept)"}
                    </div>
                    <div className="grid grid-2" style={{ marginTop: 8 }}>
                      <div className="field">
                        <label htmlFor={`qty_${l.id}`}>Quantity received</label>
                        <input id={`qty_${l.id}`} name={`qty_${l.id}`} type="text" inputMode="decimal" defaultValue={fmtQty(open)} />
                      </div>
                      <div className="field">
                        <label htmlFor={`cond_${l.id}`}>Condition</label>
                        <select id={`cond_${l.id}`} name={`cond_${l.id}`} defaultValue="good">
                          <option value="good">Good</option>
                          <option value="damaged">Damaged / rejected</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`batch_${l.id}`}>Batch / lot no.</label>
                        <input id={`batch_${l.id}`} name={`batch_${l.id}`} type="text" />
                      </div>
                      <div className="field">
                        <label htmlFor={`expiry_${l.id}`}>Expiry date</label>
                        <input id={`expiry_${l.id}`} name={`expiry_${l.id}`} type="date" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <SubmitButton className="btn btn-primary btn-block" pendingText="Saving…">
            Record goods received
          </SubmitButton>
        </form>
      )}
    </>
  );
}
