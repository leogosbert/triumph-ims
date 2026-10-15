import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { PRODUCT_SECTIONS } from "@/lib/fields";
import { ITEM_TYPE_LABELS } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { saveProduct } from "../actions";

export const metadata = { title: "New product" };

export default async function NewProductPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { role, company } = await getAppContext();
  if (!can(role, "editProducts")) redirect("/products");
  const sp = (await searchParams) ?? {};
  // A service company mostly adds services; ?type=hire etc. comes from the service screens.
  const type = typeof sp.type === "string" && sp.type in ITEM_TYPE_LABELS ? sp.type : company.business_type === "services" ? "service" : "goods";
  const unit = type === "goods" || type === "hire" ? "pcs" : type === "service" ? "job" : "hour";

  return (
    <>
      <p className="small">
        <Link href="/products">{tr("← Products")}</Link>
      </p>
      <h1>{tr("New product")}</h1>
      <Notice {...notice} />
      <form action={saveProduct}>
        <input type="hidden" name="id" value="" />
        <RecordFields sections={PRODUCT_SECTIONS} values={{ item_type: type, unit, hazardous: false, sds_on_file: false }} />
        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Adding…")}>{tr("Add product")}</SubmitButton>
      </form>
      {can(role, "editCosts") && (
        <p className="muted small" style={{ marginTop: 8 }}>{tr("You can add the supplier and cost after saving.")}</p>
      )}
    </>
  );
}
