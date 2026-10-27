import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { storeOptions } from "@/lib/stock";
import { createRequisition } from "../actions";
import { RequisitionFields } from "../RequisitionFields";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New purchase request" };

export default async function NewRequisitionPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "requestPurchases")) redirect("/");
  const probe = await supabase.from("requisitions").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New purchase request" />;
  const stores = await storeOptions(supabase, company.id);

  return (
    <>
      <BackLink href="/requisitions" label="Purchase requests" />
      <h1>{tr("New purchase request")}</h1>
      <Notice {...notice} />
      <form action={createRequisition} className="card">
        <RequisitionFields stores={stores} />
        <SubmitButton>{tr("Next: add items")}</SubmitButton>
      </form>
    </>
  );
}
