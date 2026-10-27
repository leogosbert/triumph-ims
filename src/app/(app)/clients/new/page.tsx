import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { CLIENT_SECTIONS } from "@/lib/fields";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { saveClient } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { role, company } = await getAppContext();
  if (!can(role, "editClients")) redirect("/clients");

  return (
    <>
      <BackLink href="/clients" label="Clients" />
      <h1>{tr("New client")}</h1>
      <Notice {...notice} />
      <form action={saveClient}>
        <input type="hidden" name="id" value="" />
        <RecordFields
          sections={CLIENT_SECTIONS}
          values={{ currency: company.base_currency, credit_limit: 0 }}
          lockedKeys={can(role, "setCreditLimit") ? [] : ["credit_limit"]}
        />
        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Adding…")}>{tr("Add client")}</SubmitButton>
      </form>
    </>
  );
}
