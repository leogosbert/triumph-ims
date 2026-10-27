import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { SUPPLIER_SECTIONS } from "@/lib/fields";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { saveSupplier } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { roles, company } = await getAppContext();
  if (!can(roles, "editSuppliers")) redirect("/suppliers");

  return (
    <>
      <BackLink href="/suppliers" label="Suppliers" />
      <h1>{tr("New supplier")}</h1>
      <Notice {...notice} />
      <form action={saveSupplier}>
        <input type="hidden" name="id" value="" />
        <RecordFields sections={SUPPLIER_SECTIONS} values={{ currency: company.base_currency }} />
        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Adding…")}>{tr("Add supplier")}</SubmitButton>
      </form>
    </>
  );
}
