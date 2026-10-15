"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { canPlanService, todayTz } from "@/lib/services";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Only the columns the database lets us write. */
function equipmentValues(form: FormData, path: string) {
  const every = toNumber(str(form, "service_every_months"));
  if (every !== null && (Number.isNaN(every) || !Number.isInteger(every) || every < 1 || every > 120)) {
    fail(path, "Service every must be whole months between 1 and 120.");
  }
  const installed = optional(form, "installed_on");
  return {
    client_id: str(form, "client_id"),
    product_id: optional(form, "product_id"),
    name: str(form, "name"),
    serial_no: optional(form, "serial_no"),
    location: optional(form, "location"),
    installed_on: installed,
    warranty_until: optional(form, "warranty_until"),
    service_every_months: every,
    next_service_on: optional(form, "next_service_on"),
    notes: optional(form, "notes"),
  };
}

type Supabase = Awaited<ReturnType<typeof getAppContext>>["supabase"];

/** An empty name takes the product's name. */
async function fillName(supabase: Supabase, companyId: string, values: ReturnType<typeof equipmentValues>, path: string) {
  if (!values.client_id) fail(path, "Choose the client.");
  if (values.name.length < 2 && values.product_id) {
    const { data } = await supabase.from("products").select("name").eq("id", values.product_id).eq("company_id", companyId).maybeSingle();
    if (data?.name) values.name = String(data.name).slice(0, 200);
  }
  if (values.name.length < 2) fail(path, "Enter what the equipment is, e.g. Generator 60 kVA.");
}

export async function createEquipment(form: FormData) {
  const clientParam = str(form, "back_client");
  const path = `/equipment/new${clientParam ? `?client=${encodeURIComponent(clientParam)}` : ""}`;
  const { supabase, company, role } = await getAppContext();
  if (!canPlanService(role)) fail(path, "You don't have permission to do that.");
  const values = equipmentValues(form, path);
  await fillName(supabase, company.id, values, path);
  // No next service date given: count the interval from installation (or today).
  if (!values.next_service_on && values.service_every_months) {
    values.next_service_on = addMonths(values.installed_on ?? todayTz(), values.service_every_months);
  }
  const { data, error } = await supabase
    .from("client_equipment")
    .insert({ company_id: company.id, ...values })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  revalidatePath("/equipment");
  redirect(withNotice(`/equipment/${data.id}`, { msg: "Equipment added." }));
}

export async function saveEquipment(form: FormData) {
  const id = str(form, "id");
  const path = `/equipment/${id}`;
  const { supabase, company, role } = await getAppContext();
  if (!canPlanService(role)) fail(path, "You don't have permission to do that.");
  const values = equipmentValues(form, path);
  await fillName(supabase, company.id, values, path);
  const { data, error } = await supabase
    .from("client_equipment")
    .update({ ...values, last_service_on: optional(form, "last_service_on") })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/equipment");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function setEquipmentActive(form: FormData) {
  const id = str(form, "id");
  const active = str(form, "active") === "true";
  const path = `/equipment/${id}`;
  const { supabase, company, role } = await getAppContext();
  if (!canPlanService(role)) fail(path, "You don't have permission to do that.");
  const { data, error } = await supabase
    .from("client_equipment")
    .update({ active })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/equipment");
  revalidatePath(path);
  redirect(withNotice(path, { msg: active ? "Equipment is in use again." : "Equipment marked as no longer in use." }));
}
