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
import { createVehicle } from "../actions";
import { VehicleFields } from "../VehicleFields";

export const metadata = { title: "New vehicle" };

export default async function NewVehiclePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editFleet")) redirect("/fleet");
  const probe = await supabase.from("vehicles").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New vehicle" />;
  const people = await companyPeople(supabase, company.id);
  const drivers = [...people.filter((p) => p.role === "driver"), ...people.filter((p) => p.role !== "driver")];

  return (
    <>
      <p className="small">
        <Link href="/fleet">{tr("← Vehicles")}</Link>
      </p>
      <h1>{tr("New vehicle")}</h1>
      <Notice {...notice} />
      <form action={createVehicle} className="card">
        <VehicleFields drivers={drivers} />
        <SubmitButton>{tr("Add vehicle")}</SubmitButton>
      </form>
    </>
  );
}
