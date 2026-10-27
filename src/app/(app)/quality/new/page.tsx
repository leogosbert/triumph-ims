import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/services";
import { createNcr } from "../actions";
import { NcrFields } from "../NcrFields";
import { loadNcrOptions } from "../options";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New NCR" };

export default async function NewNcrPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "seeQuality")) redirect("/");
  const probe = await supabase.from("quality_ncrs").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New NCR" />;
  const options = await loadNcrOptions(supabase, company.id);

  return (
    <>
      <BackLink href="/quality" label="Quality" />
      <h1>{tr("New NCR")}</h1>
      <Notice {...notice} />
      <form action={createNcr} className="card">
        <NcrFields options={options} base={company.base_currency} today={todayTz()} />
        <SubmitButton>{tr("Raise NCR")}</SubmitButton>
      </form>
    </>
  );
}
