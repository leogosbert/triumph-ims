import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { quoteNo } from "@/lib/sales";
import { newPurchaseOrder } from "../actions";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editPurchasing")) redirect("/purchase-orders");
  const quotationId = typeof sp.quotation === "string" ? sp.quotation : "";

  const [{ data: suppliers }, { data: quote }] = await Promise.all([
    supabase.from("suppliers").select("id, name, code").eq("company_id", company.id).eq("active", true).order("name"),
    quotationId
      ? supabase.from("quotations").select("id, number, revision, client:clients(name)").eq("id", quotationId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const q = quote as { id: string; number: string; revision: number; client: { name: string } | null } | null;

  return (
    <>
      <p className="small">
        <Link href="/purchase-orders">← Purchase orders</Link>
      </p>
      <h1>New purchase order</h1>
      {q && (
        <p className="banner ok small">
          For client quotation {quoteNo(q)} ({q.client?.name}). Its items are copied in at the last known cost.
        </p>
      )}
      {!q && (
        <p className="muted small">
          To compare several suppliers first, use a <Link href="/supplier-rfqs/new">supplier RFQ</Link> and award the winner: the PO is created
          for you.
        </p>
      )}
      <Notice {...notice} />
      <form action={newPurchaseOrder} className="card">
        <input type="hidden" name="quotation_id" value={q?.id ?? ""} />
        <div className="field">
          <label htmlFor="supplier_id">Supplier</label>
          <select id="supplier_id" name="supplier_id" required defaultValue="">
            <option value="" disabled>
              Choose a supplier
            </option>
            {((suppliers ?? []) as { id: string; name: string; code: string }[]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-primary btn-block" pendingText="Creating…">
          Create draft PO
        </SubmitButton>
      </form>
    </>
  );
}
