import { primeLang, tr } from "@/lib/tr";
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
  await primeLang();
  const notice = await readNotice(searchParams);
  const { role } = await getAppContext();
  if (!can(role, "editPurchasing")) redirect("/");
  return (
    <>
      <p className="small">
        <Link href="/supplier-rfqs">{tr("← Supplier RFQs")}</Link>
      </p>
      <h1>{tr("Ask suppliers for prices")}</h1>
      <p className="muted small">{tr("Tip: to buy for a client order, open the accepted quotation (or the client RFQ) and use “Request supplier quotes” so the items are copied across.")}</p>
      <Notice {...notice} />
      <form action={createSupplierRfq} className="card">
        <div className="field">
          <label htmlFor="title">{tr("What you need")}</label>
          <input id="title" name="title" type="text" placeholder={tr("e.g. Stock of hydraulic oil for Q4")} required />
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="due_on">{tr("Suppliers should reply by")}</label>
            <input id="due_on" name="due_on" type="date" />
          </div>
          <div className="field">
            <label htmlFor="delivery_location">{tr("Delivery to")}</label>
            <input id="delivery_location" name="delivery_location" type="text" placeholder={tr("e.g. Dar es Salaam store")} />
          </div>
        </div>
        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Creating…")}>{tr("Create and add items")}</SubmitButton>
      </form>
    </>
  );
}
