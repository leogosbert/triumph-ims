import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { storeOptions } from "@/lib/stock";
import { createTransfer } from "../actions";

export const metadata = { title: "New stock transfer" };

export default async function NewTransferPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "moveStock")) redirect("/transfers");
  const probe = await supabase.from("stock_transfers").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New stock transfer" />;
  const stores = await storeOptions(supabase, company.id);

  return (
    <>
      <p className="small">
        <Link href="/transfers">{tr("← Stock transfers")}</Link>
      </p>
      <h1>{tr("New stock transfer")}</h1>
      <Notice {...notice} />
      {stores.length < 2 ? (
        <p className="card muted">
          {tr("You need at least two stores to move stock between them.")}{" "}
          {can(role, "manageWarehouses") && <Link href="/warehouses">{tr("Add a store")}</Link>}
        </p>
      ) : (
        <form action={createTransfer} className="card">
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="from_warehouse_id">{tr("From store")}</label>
              <select id="from_warehouse_id" name="from_warehouse_id" required defaultValue={stores[0].id}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="to_warehouse_id">{tr("To store")}</label>
              <select id="to_warehouse_id" name="to_warehouse_id" required defaultValue={stores[1].id}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reason">{tr("Why")}</label>
              <input id="reason" name="reason" type="text" maxLength={300} placeholder={tr("e.g. Top up the branch store")} />
            </div>
            <div className="field">
              <label htmlFor="vehicle">{tr("Vehicle or driver")}</label>
              <input id="vehicle" name="vehicle" type="text" maxLength={120} placeholder={tr("e.g. T 482 DKL")} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="notes">{tr("Notes")}</label>
              <textarea id="notes" name="notes" maxLength={1000} />
            </div>
          </div>
          <SubmitButton>{tr("Next: add items")}</SubmitButton>
        </form>
      )}
    </>
  );
}
