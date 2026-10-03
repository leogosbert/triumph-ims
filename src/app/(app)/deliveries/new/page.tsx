import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { can } from "@/lib/roles";
import { storeOptions } from "@/lib/stock";
import { newDelivery } from "../actions";

export const metadata = { title: "New delivery note" };

export default async function NewDeliveryPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editDeliveries")) redirect("/deliveries");
  const [clients, stores] = await Promise.all([clientOptions(supabase, company.id), storeOptions(supabase, company.id)]);
  return (
    <>
      <p className="small">
        <Link href="/deliveries">← Deliveries</Link>
      </p>
      <h1>New delivery note</h1>
      <p className="muted small">
        To deliver a won order, open the accepted quotation and use &ldquo;Create delivery note&rdquo;: the items are copied, and
        later deliveries only include what is still outstanding.
      </p>
      <Notice {...notice} />
      <form action={newDelivery} className="card">
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
        <div className="field">
          <label htmlFor="warehouse_id">From store</label>
          <select id="warehouse_id" name="warehouse_id">
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-primary btn-block" pendingText="Creating…">
          Create delivery note
        </SubmitButton>
      </form>
    </>
  );
}
