"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { CLIENT_SECTIONS, parseSections } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { saveRecord } from "@/lib/records";
import { can } from "@/lib/roles";

export async function saveClient(form: FormData) {
  const { supabase, company, role } = await getAppContext();
  const id = str(form, "id");
  const back = id ? `/clients/${id}` : "/clients/new";
  if (!can(role, "editClients")) redirect(withNotice(back, { error: "You don't have permission to edit clients." }));

  const { values, error } = parseSections(form, CLIENT_SECTIONS);
  if (error) redirect(withNotice(back, { error }));
  if (!can(role, "setCreditLimit")) delete values.credit_limit;

  const res = await saveRecord(supabase, "clients", company.id, id, values);
  if (res.error) redirect(withNotice(back, { error: friendlyError(res.error) }));
  revalidatePath("/clients");
  redirect(withNotice(`/clients/${res.id}`, { msg: id ? "Client saved." : "Client added." }));
}

export async function setClientActive(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const active = str(form, "active") === "true";
  const { data, error } = await supabase
    .from("clients")
    .update({ active })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length)
    redirect(withNotice(`/clients/${id}`, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath("/clients");
  redirect(withNotice(`/clients/${id}`, { msg: active ? "Client restored." : "Client archived." }));
}

export async function addContact(form: FormData) {
  const { supabase, company } = await getAppContext();
  const clientId = str(form, "client_id");
  const back = `/clients/${clientId}#contacts`;
  const { error } = await supabase.from("client_contacts").insert({
    company_id: company.id,
    client_id: clientId,
    kind: str(form, "kind") || "other",
    name: optional(form, "name"),
    position: optional(form, "position"),
    email: optional(form, "email")?.toLowerCase() ?? null,
    phone: optional(form, "phone"),
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(`/clients/${clientId}`);
  redirect(withNotice(back, { msg: "Contact added." }));
}

export async function removeContact(form: FormData) {
  const { supabase, company } = await getAppContext();
  const clientId = str(form, "client_id");
  const back = `/clients/${clientId}#contacts`;
  const { data, error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("id", str(form, "contact_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) redirect(withNotice(back, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath(`/clients/${clientId}`);
  redirect(withNotice(back, { msg: "Contact removed." }));
}
