import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { n } from "@/lib/finance";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { newBill } from "../actions";
import { BillFields } from "../BillFields";

export const metadata = { title: "New supplier bill" };

export default async function NewBillPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const poId = typeof sp.po === "string" ? sp.po : null;
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editBills")) redirect("/bills");

  const [{ data: po }, { data: sups }] = await Promise.all([
    poId
      ? supabase
          .from("purchase_orders")
          .select("id, number, supplier_id, currency, exchange_rate, subtotal, freight, vat_amount, payment_terms, supplier:suppliers(name)")
          .eq("id", poId)
          .eq("company_id", company.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("suppliers").select("id, name, code, currency").eq("company_id", company.id).eq("active", true).order("name").limit(2000),
  ]);
  const suppliers = (sups ?? []) as { id: string; name: string; code: string; currency: string }[];

  return (
    <>
      <p className="small">
        <Link href={po ? `/purchase-orders/${po.id}` : "/bills"}>← {po ? po.number : "Supplier bills"}</Link>
      </p>
      <h1>Record a supplier bill</h1>
      <p className="muted small">
        Enter the supplier&apos;s invoice as you received it. {po && "The amounts are filled in from the purchase order — change them to match the invoice."}
      </p>
      <Notice {...notice} />
      <form action={newBill} className="card">
        {po ? (
          <>
            <input type="hidden" name="po_id" value={po.id} />
            <input type="hidden" name="supplier_id" value={po.supplier_id} />
            <p>
              <strong>{(po.supplier as unknown as { name: string } | null)?.name}</strong> · {po.number}
            </p>
          </>
        ) : (
          <div className="field">
            <label htmlFor="supplier_id">Supplier</label>
            <select id="supplier_id" name="supplier_id" required defaultValue="">
              <option value="" disabled>
                Choose a supplier
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
        )}
        <BillFields
          base={company.base_currency}
          v={{
            supplier_invoice_no: null,
            bill_date: todayTz(),
            due_date: null,
            currency: po?.currency ?? company.base_currency,
            exchange_rate: po ? n(po.exchange_rate) : 1,
            subtotal: po ? n(po.subtotal) + n(po.freight) : 0,
            vat_amount: po ? n(po.vat_amount) : 0,
            notes: null,
          }}
        />
        <SubmitButton className="btn btn-primary btn-block" pendingText="Saving…">
          Save bill
        </SubmitButton>
      </form>
    </>
  );
}
