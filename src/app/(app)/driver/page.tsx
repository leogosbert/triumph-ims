import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { type SearchParams } from "@/lib/messages";
import { getDict } from "@/lib/lang";
import { DriverApp, type DriverDelivery } from "./DriverApp";

export const metadata = { title: "My deliveries" };
export const dynamic = "force-dynamic";

type Row = Omit<DriverDelivery, "client" | "lines"> & {
  updated_at: string;
  client: { name: string } | null;
  lines: { line_no: number; description: string; quantity: number; unit: string }[] | null;
};

export default async function DriverPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const only = typeof sp.d === "string" ? sp.d : null;
  const { supabase, company, role, user } = await getAppContext();
  const { t } = await getDict();
  const supervisor = role === "management" || role === "warehouse";
  if (role !== "driver" && !supervisor) redirect("/");
  if (supervisor && !only) redirect("/deliveries");

  let q = supabase
    .from("deliveries")
    .select(
      "id, number, status, planned_date, delivery_site, contact_name, contact_phone, vehicle, notes, delivered_at, received_by_name, failed_reason, updated_at, client:clients(name), lines:delivery_lines(line_no, description, quantity, unit)",
    )
    .eq("company_id", company.id)
    .in("status", ["dispatched", "delivered", "failed"]);
  q = only ? q.eq("id", only) : q.eq("driver_id", user.id);
  const { data } = await q.order("planned_date", { ascending: true, nullsFirst: false }).limit(60);

  // Show work still to do, plus anything finished in the last three days.
  const recent = Date.now() - 3 * 864e5;
  const deliveries: DriverDelivery[] = ((data ?? []) as unknown as Row[])
    .filter((d) => only || d.status === "dispatched" || Date.parse(d.updated_at) >= recent)
    .map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      planned_date: d.planned_date,
      delivery_site: d.delivery_site,
      contact_name: d.contact_name,
      contact_phone: d.contact_phone,
      vehicle: d.vehicle,
      notes: d.notes,
      delivered_at: d.delivered_at,
      received_by_name: d.received_by_name,
      failed_reason: d.failed_reason,
      client: d.client?.name ?? "",
      lines: [...(d.lines ?? [])].sort((a, b) => a.line_no - b.line_no),
    }));

  return (
    <>
      {only && (
        <p className="small">
          <Link href={`/deliveries/${only}`}>← Back to the delivery note</Link>
        </p>
      )}
      <div className="page-head">
        <h1>{only ? t["dr.record"] : t["dr.title"]}</h1>
      </div>
      <DriverApp companyId={company.id} userId={user.id} deliveries={deliveries} t={t} />
    </>
  );
}
