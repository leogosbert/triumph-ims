import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { PRODUCT_SECTIONS } from "@/lib/fields";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { saveProduct } from "../actions";

export const metadata = { title: "New product" };

export default async function NewProductPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { role } = await getAppContext();
  if (!can(role, "editProducts")) redirect("/products");

  return (
    <>
      <p className="small">
        <Link href="/products">{tr("← Products")}</Link>
      </p>
      <h1>{tr("New product")}</h1>
      <Notice {...notice} />
      <form action={saveProduct}>
        <input type="hidden" name="id" value="" />
        <RecordFields sections={PRODUCT_SECTIONS} values={{ unit: "pcs", hazardous: false, sds_on_file: false }} />
        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Adding…")}>{tr("Add product")}</SubmitButton>
      </form>
      {can(role, "editCosts") && (
        <p className="muted small" style={{ marginTop: 8 }}>{tr("You can add the supplier and cost after saving.")}</p>
      )}
    </>
  );
}
