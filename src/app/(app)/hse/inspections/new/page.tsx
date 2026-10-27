import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { recordInspection } from "../../actions";
import { loadLinkOptions } from "../../options";
import { InspectionFields } from "../InspectionFields";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Record inspection" };

export default async function NewInspectionPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await getAppContext();
  const probe = await supabase.from("hse_inspections").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="Record inspection" />;
  const options = await loadLinkOptions(supabase, company.id, false);

  return (
    <>
      <BackLink href="/hse?tab=inspections" label="Health & safety" />
      <h1>{tr("Inspection / toolbox talk")}</h1>
      <Notice {...notice} />
      <form action={recordInspection} className="card">
        <InspectionFields options={options} />
        <SubmitButton>{tr("Save")}</SubmitButton>
      </form>
    </>
  );
}
