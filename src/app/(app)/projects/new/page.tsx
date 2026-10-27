import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { companyPeople } from "@/lib/people";
import { createProject } from "../actions";
import { canKeepProjects } from "../projectData";
import { ProjectFields } from "../ProjectFields";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canKeepProjects(roles)) redirect("/projects");
  const probe = await supabase.from("projects").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New project" />;
  const [clients, people] = await Promise.all([clientOptions(supabase, company.id), companyPeople(supabase, company.id)]);

  return (
    <>
      <BackLink href="/projects" label="Projects" />
      <h1>{tr("New project")}</h1>
      <Notice {...notice} />
      {clients.length === 0 ? (
        <p className="card muted">
          {tr("Add the client first.")} <Link href="/clients/new">{tr("+ Client")}</Link>
        </p>
      ) : (
        <form action={createProject} className="card">
          <ProjectFields clients={clients} people={people} currency={company.base_currency} />
          <SubmitButton>{tr("Add project")}</SubmitButton>
        </form>
      )}
    </>
  );
}
