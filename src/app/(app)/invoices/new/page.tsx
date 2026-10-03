import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { can } from "@/lib/roles";
import { newInvoice } from "../actions";

export const metadata = { title: "New invoice" };

type Dn = { id: string; number: string; delivered_at: string | null; client: { name: string } | null };

export default async function NewInvoicePage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editInvoices")) redirect("/invoices");

  const [clients, { data: dnData }, { data: invoiced }] = await Promise.all([
    clientOptions(supabase, company.id),
    supabase
      .from("deliveries")
      .select("id, number, delivered_at, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "delivered")
      .order("delivered_at", { ascending: false })
      .limit(100),
    supabase.from("invoices").select("delivery_id").eq("company_id", company.id).neq("status", "cancelled").not("delivery_id", "is", null),
  ]);
  const done = new Set(((invoiced ?? []) as { delivery_id: string }[]).map((r) => r.delivery_id));
  const ready = ((dnData ?? []) as unknown as Dn[]).filter((d) => !done.has(d.id));

  return (
    <>
      <p className="small">
        <Link href="/invoices">← Invoices</Link>
      </p>
      <h1>New invoice</h1>
      <Notice {...notice} />

      <section className="card">
        <h2>Delivered, not yet invoiced ({ready.length})</h2>
        {ready.length === 0 ? (
          <p className="muted small">Nothing waiting. Delivered delivery notes appear here until they are invoiced.</p>
        ) : (
          <ul className="list">
            {ready.map((d) => (
              <li key={d.id} className="row">
                <span>
                  <strong>{d.client?.name}</strong>
                  <span className="small muted">
                    {" "}
                    · <Link href={`/deliveries/${d.id}`}>{d.number}</Link>
                    {d.delivered_at && ` · ${formatDate(d.delivered_at)}`}
                  </span>
                </span>
                <form action={newInvoice}>
                  <input type="hidden" name="delivery_id" value={d.id} />
                  <input type="hidden" name="back" value="/invoices/new" />
                  <SubmitButton className="btn btn-small btn-primary" pendingText="…">
                    Invoice it
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">To invoice a whole order (for example an advance payment invoice), open the accepted quotation and use &ldquo;Create invoice&rdquo;.</p>
      </section>

      <form action={newInvoice} className="card">
        <h2>Blank invoice</h2>
        <input type="hidden" name="back" value="/invoices/new" />
        <div className="field">
          <label htmlFor="client_id">Client</label>
          <select id="client_id" name="client_id" required defaultValue="">
            <option value="" disabled>
              Choose a client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-block" pendingText="Creating…">
          Create blank invoice
        </SubmitButton>
      </form>
    </>
  );
}
