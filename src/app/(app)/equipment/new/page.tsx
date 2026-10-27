import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions, productOptions } from "@/lib/options";
import { canPlanService } from "@/lib/services";
import { createEquipment } from "../actions";
import { EquipmentFields } from "../EquipmentFields";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New equipment" };

export default async function NewEquipmentPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!canPlanService(role)) redirect("/equipment");
  const probe = await supabase.from("client_equipment").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New equipment" />;
  const [clients, products] = await Promise.all([clientOptions(supabase, company.id), productOptions(supabase, company.id)]);
  const raw = Array.isArray(sp.client) ? sp.client[0] : sp.client;
  const clientId = raw && clients.some((c) => c.id === raw) ? raw : undefined;

  return (
    <>
      <BackLink href={clientId ? `/equipment?client=${clientId}` : "/equipment"} label="Equipment" />
      <h1>{tr("New equipment")}</h1>
      <Notice {...notice} />
      <form action={createEquipment} className="card">
        {clientId && <input type="hidden" name="back_client" value={clientId} />}
        <EquipmentFields clients={clients} products={products} clientId={clientId} />
        <SubmitButton>{tr("Add equipment")}</SubmitButton>
      </form>
    </>
  );
}
