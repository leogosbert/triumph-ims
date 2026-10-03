"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { isRole } from "@/lib/roles";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const CCY = /^[A-Z]{3}$/;

export async function updateCompany(form: FormData) {
  const { supabase, company } = await requireManager();
  const back = "/settings/company";

  const name = str(form, "name");
  const base = str(form, "base_currency").toUpperCase();
  const second = (optional(form, "second_currency") ?? "").toUpperCase() || null;
  const primary = str(form, "primary_color");
  const accent = str(form, "accent_color");

  if (name.length < 2) redirect(withNotice(back, { error: "Please enter the company name." }));
  if (!CCY.test(base) || (second && !CCY.test(second)))
    redirect(withNotice(back, { error: "Currencies must be 3-letter codes, like TZS or USD." }));
  if (!HEX.test(primary) || !HEX.test(accent)) redirect(withNotice(back, { error: "Please pick valid colours." }));

  const { error } = await supabase
    .from("companies")
    .update({
      name,
      legal_name: optional(form, "legal_name"),
      tin: optional(form, "tin"),
      vrn: optional(form, "vrn"),
      registration_no: optional(form, "registration_no"),
      address: optional(form, "address"),
      phone: optional(form, "phone"),
      email: optional(form, "email")?.toLowerCase() ?? null,
      website: optional(form, "website"),
      base_currency: base,
      second_currency: second,
      primary_color: primary,
      accent_color: accent,
      bank_details: optional(form, "bank_details"),
      document_footer: optional(form, "document_footer"),
    })
    .eq("id", company.id);

  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath("/", "layout");
  redirect(withNotice(back, { msg: "Company details saved." }));
}

/** Saves the storage path of a logo the browser has just uploaded. */
export async function setLogo(path: string | null) {
  const { supabase, company } = await requireManager();
  if (path !== null && !path.startsWith(`${company.id}/`)) {
    return { error: "That file does not belong to this company." };
  }
  const old = company.logo_path;
  const { error } = await supabase.from("companies").update({ logo_path: path }).eq("id", company.id);
  if (error) return { error: friendlyError(error.message) };
  if (old && old !== path) {
    await supabase.storage.from("branding").remove([old]);
  }
  revalidatePath("/", "layout");
  return { error: null };
}

export async function inviteMember(form: FormData) {
  const { supabase, company } = await requireManager();
  const back = "/settings/team";
  const email = str(form, "email").toLowerCase();
  const role = str(form, "role");
  if (!isRole(role)) redirect(withNotice(back, { error: "Please choose a role." }));

  const { error } = await supabase.rpc("invite_member", { p_company: company.id, p_email: email, p_role: role });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back);
  redirect(
    withNotice(back, {
      msg: `Invitation saved. Ask ${email} to open the app and create an account with this email; they'll be offered to join.`,
    }),
  );
}

export async function revokeInvitation(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: str(form, "invitation_id") });
  const back = "/settings/team";
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back);
  redirect(withNotice(back, { msg: "Invitation cancelled." }));
}

export async function updateMember(form: FormData) {
  const { supabase } = await requireManager();
  const back = "/settings/team";
  const role = str(form, "role");
  const active = str(form, "active") === "true";
  if (!isRole(role)) redirect(withNotice(back, { error: "Please choose a role." }));

  const { error } = await supabase.rpc("update_membership", {
    p_membership: str(form, "membership_id"),
    p_role: role,
    p_active: active,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back);
  redirect(withNotice(back, { msg: "Team member updated." }));
}
