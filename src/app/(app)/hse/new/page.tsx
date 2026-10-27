import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { reportIncident } from "../actions";
import { IncidentFields } from "../IncidentFields";
import { loadLinkOptions } from "../options";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Report incident" };

export default async function NewIncidentPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await getAppContext();
  const probe = await supabase.from("hse_incidents").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="Report incident" />;
  const options = await loadLinkOptions(supabase, company.id, true);

  return (
    <>
      <BackLink href="/hse" label="Health & safety" />
      <h1>{tr("Report incident")}</h1>
      <p className="muted small">{tr("Accidents and near misses. Report it now; management will follow up.")}</p>
      <Notice {...notice} />
      <form action={reportIncident} className="card">
        <IncidentFields options={options} />
        <SubmitButton>{tr("Send report")}</SubmitButton>
      </form>
    </>
  );
}
