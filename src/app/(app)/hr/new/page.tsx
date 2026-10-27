import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { can } from "@/lib/roles";
import { createEmployee } from "../actions";
import { EmployeeFields } from "../EmployeeFields";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New employee" };

export default async function NewEmployeePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "manageHr")) redirect("/hr");
  const { data: linked, error } = await supabase.from("employees").select("user_id").eq("company_id", company.id).not("user_id", "is", null).limit(5000);
  if (isMissingTable(error)) return <NotReady title="New employee" />;
  const taken = new Set(((linked ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const logins = (await companyPeople(supabase, company.id)).filter((p) => !taken.has(p.id));

  return (
    <>
      <BackLink href="/hr" label="Employees" />
      <h1>{tr("New employee")}</h1>
      <Notice {...notice} />
      <form action={createEmployee} className="card">
        <EmployeeFields logins={logins} />
        <SubmitButton>{tr("Add employee")}</SubmitButton>
      </form>
    </>
  );
}
