import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { createSupplierRfq } from "../actions";

export const metadata = { title: "New supplier RFQ" };

export default async function NewSupplierRfqPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { role } = await getAppContext();
  if (!can(role, "editPurchasing")) redirect("/");
  return (
    <>
      <p className="small">
        <Link href="/supplier-rfqs">← Supplier RFQs</Link>
      </p>
      <h1>Ask suppliers for prices</h1>
      <p className="muted small">
        Tip: to buy for a client order, open the accepted quotation (or the client RFQ) and use &ldquo;Request supplier
        quotes&rdquo; so the items are copied across.
      </p>
      <Notice {...notice} />
      <form action={createSupplierRfq} className="card">
        <div className="field">
          <label htmlFor="title">What you need</label>
          <input id="title" name="title" type="text" placeholder="e.g. Stock of hydraulic oil for Q4" required />
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="due_on">Suppliers should reply by</label>
            <input id="due_on" name="due_on" type="date" />
          </div>
          <div className="field">
            <label htmlFor="delivery_location">Delivery to</label>
            <input id="delivery_location" name="delivery_location" type="text" placeholder="e.g. Dar es Salaam store" />
          </div>
        </div>
        <SubmitButton className="btn btn-primary btn-block" pendingText="Creating…">
          Create and add items
        </SubmitButton>
      </form>
    </>
  );
}
