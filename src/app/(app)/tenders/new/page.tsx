import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { OPEN_STAGES, isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { can } from "@/lib/roles";
import { createTender } from "../actions";
import { TenderFields } from "../TenderFields";

export const metadata = { title: "New tender" };

export default async function NewTenderPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  const [{ data: opps, error }, { data: clients }, people] = await Promise.all([
    supabase.from("opportunities").select("id, number, title").eq("company_id", company.id).in("stage", OPEN_STAGES).order("created_at", { ascending: false }).limit(300),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(3000),
    companyPeople(supabase, company.id),
  ]);
  if (isMissingTable(error)) return <NotReady title="New tender" />;

  return (
    <>
      <p className="small">
        <Link href="/tenders">{tr("← Tenders")}</Link>
      </p>
      <h1>{tr("New tender")}</h1>
      <p className="muted small">{tr("Record the tender as soon as you see it: the app reminds you before it closes and keeps the checklist of papers.")}</p>
      <Notice {...notice} />
      <form action={createTender} className="card">
        <TenderFields
          v={{ opportunity_id: typeof sp.opportunity === "string" ? sp.opportunity : null, currency: company.base_currency }}
          clients={(clients ?? []) as { id: string; name: string }[]}
          people={people.filter((p) => p.role === "sales" || p.role === "management")}
          opportunities={(opps ?? []) as { id: string; number: string; title: string }[]}
          base={company.base_currency}
        />
        <SubmitButton>{tr("Add tender")}</SubmitButton>
      </form>
    </>
  );
}
