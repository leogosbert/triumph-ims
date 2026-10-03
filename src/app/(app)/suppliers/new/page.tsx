import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { SUPPLIER_SECTIONS } from "@/lib/fields";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { saveSupplier } from "../actions";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { role, company } = await getAppContext();
  if (!can(role, "editSuppliers")) redirect("/suppliers");

  return (
    <>
      <p className="small">
        <Link href="/suppliers">← Suppliers</Link>
      </p>
      <h1>New supplier</h1>
      <Notice {...notice} />
      <form action={saveSupplier}>
        <input type="hidden" name="id" value="" />
        <RecordFields sections={SUPPLIER_SECTIONS} values={{ currency: company.base_currency }} />
        <SubmitButton className="btn btn-primary btn-block" pendingText="Adding…">
          Add supplier
        </SubmitButton>
      </form>
    </>
  );
}
