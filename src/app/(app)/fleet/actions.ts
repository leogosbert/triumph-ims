"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function int(form: FormData, key: string, path: string) {
  const v = toNumber(str(form, key));
  if (v === null) return null;
  if (Number.isNaN(v) || v < 0) fail(path, "Kilometres must be a whole number of zero or more.");
  return Math.round(v);
}

function vehicleValues(form: FormData, path: string) {
  const cap = toNumber(str(form, "capacity_kg"));
  if (cap !== null && (Number.isNaN(cap) || cap <= 0)) fail(path, "Capacity must be a number above zero.");
  return {
    plate: str(form, "plate"),
    name: optional(form, "name"),
    kind: str(form, "kind") || "truck",
    capacity_kg: cap,
    driver_id: optional(form, "driver_id"),
    insurance_expires: optional(form, "insurance_expires"),
    inspection_expires: optional(form, "inspection_expires"),
    service_due_on: optional(form, "service_due_on"),
    service_due_km: int(form, "service_due_km", path),
    odometer_km: int(form, "odometer_km", path),
    notes: optional(form, "notes"),
  };
}

function plateError(message: string) {
  return /vehicles_plate_key|duplicate key/.test(message) ? "There is already a vehicle with that plate." : message;
}

export async function createVehicle(form: FormData) {
  const values = vehicleValues(form, "/fleet/new");
  if (values.plate.length < 2) fail("/fleet/new", "Enter the number plate.");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ company_id: company.id, ...values })
    .select("id")
    .single();
  if (error) fail("/fleet/new", plateError(error.message));
  revalidatePath("/fleet");
  redirect(withNotice(`/fleet/${data.id}`, { msg: "Vehicle added." }));
}

export async function saveVehicle(form: FormData) {
  const id = str(form, "id");
  const path = `/fleet/${id}`;
  const values = vehicleValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("vehicles")
    .update({ ...values, active: str(form, "active") !== "false" })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, plateError(error?.message ?? "0 rows"));
  revalidatePath("/fleet");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function addVehicleLog(form: FormData) {
  const id = str(form, "vehicle_id");
  const path = `/fleet/${id}#log`;
  const litres = toNumber(str(form, "litres"));
  const amount = toNumber(str(form, "amount"));
  if ((litres !== null && (Number.isNaN(litres) || litres <= 0)) || (amount !== null && (Number.isNaN(amount) || amount < 0))) {
    fail(path, "Litres and amount must be numbers.");
  }
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("vehicle_logs").insert({
    company_id: company.id,
    vehicle_id: id,
    kind: str(form, "kind") || "fuel",
    happened_on: str(form, "happened_on") || undefined,
    odometer_km: int(form, "odometer_km", path),
    litres,
    amount,
    note: optional(form, "note"),
  });
  if (error) fail(path, error.message);
  revalidatePath(`/fleet/${id}`);
  revalidatePath("/fleet");
  redirect(withNotice(path, { msg: "Saved in the vehicle log." }));
}

export async function removeVehicleLog(form: FormData) {
  const id = str(form, "vehicle_id");
  const path = `/fleet/${id}#log`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("vehicle_logs").delete().eq("id", str(form, "log_id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/fleet/${id}`);
  redirect(withNotice(path, { msg: "Removed." }));
}
