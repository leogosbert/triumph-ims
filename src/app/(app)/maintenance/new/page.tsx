import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { todayTz } from "@/lib/services";
import { createContract } from "../actions";
import { ContractFields, type EquipmentOption } from "../ContractFields";
import { canKeepContracts } from "../rules";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New maintenance contract" };

export default async function NewContractPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!canKeepContracts(role)) redirect("/maintenance");
  const { data: eqData, error } = await supabase
    .from("client_equipment")
    .select("id, name, serial_no, client_id, client:clients(name)")
    .eq("company_id", company.id)
    .eq("active", true)
    .order("name")
    .limit(2000);
  if (isMissingTable(error)) return <NotReady title="New maintenance contract" />;
  const clients = await clientOptions(supabase, company.id);
  const equipment = ((eqData ?? []) as unknown as EquipmentOption[]).sort((a, b) =>
    `${a.client?.name ?? ""} ${a.name}`.localeCompare(`${b.client?.name ?? ""} ${b.name}`),
  );

  return (
    <>
      <BackLink href="/maintenance" label="Maintenance contracts" />
      <h1>{tr("New maintenance contract")}</h1>
      <Notice {...notice} />
      <form action={createContract} className="card">
        <ContractFields clients={clients} equipment={equipment} currency={company.base_currency} today={todayTz()} />
        <SubmitButton>{tr("Add contract")}</SubmitButton>
      </form>
    </>
  );
}
