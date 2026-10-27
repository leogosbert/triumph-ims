"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { FREQUENCIES, canPlanService, checklistFromText } from "@/lib/services";
import { canKeepContracts } from "./rules";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

/** Fields both the new and the edit form send (only columns the database lets us update). */
function contractValues(form: FormData, path: string) {
  const title = str(form, "title");
  if (title.length < 2) fail(path, "Enter a title for the contract.");
  const frequency = str(form, "frequency");
  if (!FREQUENCIES[frequency]) fail(path, "Choose how often the visits happen.");
  const price = toNumber(str(form, "price"));
  if (price !== null && (Number.isNaN(price) || price < 0)) fail(path, "The price must be a number of zero or more.");
  const hours = toNumber(str(form, "response_hours"));
  if (hours !== null && (Number.isNaN(hours) || !Number.isInteger(hours) || hours < 1 || hours > 720)) {
    fail(path, "Response time must be whole hours between 1 and 720.");
  }
  const currency = str(form, "currency").toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) fail(path, "Currencies must be 3-letter codes, like TZS or USD.");
  return {
    title,
    frequency,
    ends_on: optional(form, "ends_on"),
    visit_title: optional(form, "visit_title"),
    checklist: checklistFromText(str(form, "checklist")),
    response_hours: hours,
    price,
    currency: currency || undefined,
    equipment_id: optional(form, "equipment_id"),
    site: optional(form, "site"),
    notes: optional(form, "notes"),
  };
}

type Supabase = Awaited<ReturnType<typeof getAppContext>>["supabase"];

/** The equipment must belong to the contract's client; its location fills an empty site. */
async function checkEquipment(supabase: Supabase, companyId: string, equipmentId: string | null, clientId: string, path: string) {
  if (!equipmentId) return null;
  const { data } = await supabase
    .from("client_equipment")
    .select("client_id, location")
    .eq("id", equipmentId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) fail(path, "That equipment wasn't found.");
  if (data.client_id !== clientId) fail(path, "The equipment belongs to another client.");
  return (data.location as string | null) ?? null;
}

export async function createContract(form: FormData) {
  const path = "/maintenance/new";
  const { supabase, company, roles } = await getAppContext();
  if (!canKeepContracts(roles)) fail(path, "Only management and sales can add maintenance contracts.");
  const values = contractValues(form, path);
  const clientId = str(form, "client_id");
  if (!clientId) fail(path, "Choose the client.");
  const startsOn = str(form, "starts_on");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) fail(path, "Enter the start date.");
  if (values.ends_on && values.ends_on < startsOn) fail(path, "The end date must be after the start date.");
  const location = await checkEquipment(supabase, company.id, values.equipment_id, clientId, path);
  const { data, error } = await supabase
    .from("service_contracts")
    .insert({
      company_id: company.id,
      client_id: clientId,
      starts_on: startsOn,
      next_visit_on: optional(form, "next_visit_on") ?? startsOn,
      ...values,
      site: values.site ?? location,
      currency: values.currency ?? company.base_currency,
    })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  revalidatePath("/maintenance");
  redirect(withNotice(`/maintenance/${data.id}`, { msg: "Maintenance contract added." }));
}

export async function saveContract(form: FormData) {
  const id = str(form, "id");
  const path = `/maintenance/${id}`;
  const { supabase, company, roles } = await getAppContext();
  if (!canKeepContracts(roles)) fail(path, "Only management and sales can change maintenance contracts.");
  const values = contractValues(form, path);
  const { data: current } = await supabase
    .from("service_contracts")
    .select("client_id, starts_on")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!current) fail(path, "0 rows");
  if (values.ends_on && values.ends_on < current.starts_on) fail(path, "The end date must be after the start date.");
  await checkEquipment(supabase, company.id, values.equipment_id, current.client_id, path);
  const nextVisit = optional(form, "next_visit_on");
  const { data, error } = await supabase
    .from("service_contracts")
    .update({ ...values, ...(nextVisit ? { next_visit_on: nextVisit } : {}) })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/maintenance");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

const STATUS_MSG: Record<string, string> = {
  active: "Contract is active again.",
  paused: "Contract paused: no visits are planned until you resume it.",
  ended: "Contract ended.",
};

export async function setContractStatus(form: FormData) {
  const id = str(form, "id");
  const status = str(form, "status");
  const path = `/maintenance/${id}`;
  if (!STATUS_MSG[status]) fail(path, "Something went wrong. Please try again.");
  const { supabase, company, roles } = await getAppContext();
  if (!canKeepContracts(roles)) fail(path, "Only management and sales can change maintenance contracts.");
  const { data, error } = await supabase
    .from("service_contracts")
    .update({ status })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/maintenance");
  revalidatePath(path);
  redirect(withNotice(path, { msg: STATUS_MSG[status] }));
}

/** Creates jobs for the visits due in the next 14 days (public.create_due_service_visits). */
export async function planDueVisits() {
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail("/maintenance", "You cannot plan service visits.");
  const { data, error } = await supabase.rpc("create_due_service_visits", { p_company: company.id });
  if (error) fail("/maintenance", error.message);
  revalidatePath("/maintenance");
  revalidatePath("/jobs");
  redirect(`/maintenance?planned=${Number(data ?? 0)}`);
}
