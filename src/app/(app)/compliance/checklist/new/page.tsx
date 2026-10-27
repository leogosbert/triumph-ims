import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { createItem } from "../../actions";
import { ItemFields } from "../../ItemFields";
import { BackLink } from "@/components/BackLink";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "New compliance item" };

export default async function NewItemPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager } = await getAppContext();
  if (!isManager && !hasRole(roles, "finance")) redirect("/compliance/checklist");
  const lic = await supabase.from("licences").select("id, name").eq("company_id", company.id).order("name").limit(500);
  if (isMissingTable(lic.error)) return <NotReady title="New compliance item" />;
  const people = await companyPeople(supabase, company.id);

  return (
    <>
      <BackLink href="/compliance/checklist" label="Checklist" />
      <h1>{tr("Add your own item")}</h1>
      <p className="muted small">
        {tr("For anything not in the catalogue: a client's vendor renewal, a permit from your council, a board decision to follow up.")}
        {!isManager && ` ${tr("Finance can add tax and social-security items.")}`}
      </p>
      <Notice {...notice} />
      <form action={createItem} className="card">
        <ItemFields
          v={{ frequency: "none" }}
          people={people}
          licences={(lic.data ?? []) as { id: string; name: string }[]}
          categories={isManager ? undefined : ["tax", "social_security"]}
        />
        <SubmitButton className="btn btn-primary btn-block">{tr("Add to the checklist")}</SubmitButton>
      </form>
    </>
  );
}
