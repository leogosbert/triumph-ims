import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { can } from "@/lib/roles";
import { createOpportunity } from "../actions";
import { OpportunityFields } from "../OpportunityFields";

export const metadata = { title: "New opportunity" };

export default async function NewOpportunityPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  const probe = await supabase.from("opportunities").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New opportunity" />;
  const [{ data: clients }, people] = await Promise.all([
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(3000),
    companyPeople(supabase, company.id),
  ]);
  const client = typeof sp.client === "string" ? sp.client : null;

  return (
    <>
      <p className="small">
        <Link href="/crm">{tr("← Pipeline")}</Link>
      </p>
      <h1>{tr("New opportunity")}</h1>
      <p className="muted small">{tr("A possible order: from the first call to the purchase order. Record it early so nothing is forgotten.")}</p>
      <Notice {...notice} />
      <form action={createOpportunity} className="card">
        <OpportunityFields
          v={{ client_id: client, source: client ? "existing_client" : "other", currency: company.base_currency }}
          clients={(clients ?? []) as { id: string; name: string }[]}
          people={people.filter((p) => p.role === "sales" || p.role === "management")}
          base={company.base_currency}
        />
        <div className="field">
          <label>
            <input type="checkbox" name="stage" value="qualified" /> {tr("Already qualified (real need and budget confirmed)")}
          </label>
        </div>
        <SubmitButton>{tr("Add opportunity")}</SubmitButton>
      </form>
    </>
  );
}
