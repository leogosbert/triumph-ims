"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BRANCH_DOCS, type BranchDoc } from "@/lib/branches";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(branchError(error)) }));
}

function branchError(message: string) {
  if (/branches_name_key|duplicate key.*name/.test(message)) return "There is already a branch with that name.";
  if (/branches_code_key/.test(message)) return "Another branch already uses that code.";
  if (/branches_code_check|code ~/.test(message)) return "The code can have up to 12 capital letters, numbers and dashes.";
  if (/_branch_fk|foreign key/.test(message)) return "This branch still has stores, people or documents. Move them first, or mark the branch as closed.";
  return message;
}

function branchValues(form: FormData) {
  return {
    name: str(form, "name"),
    code: optional(form, "code")?.toUpperCase() ?? null,
    address: optional(form, "address"),
    phone: optional(form, "phone"),
    manager_id: optional(form, "manager_id"),
  };
}

export async function createBranch(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("branches").insert({ company_id: company.id, ...branchValues(form) });
  if (error) fail("/branches", error.message);
  revalidatePath("/branches");
  redirect(withNotice("/branches", { msg: "Branch added. Now put its stores and people in it." }));
}

export async function saveBranch(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase
    .from("branches")
    .update({ ...branchValues(form), active: str(form, "active") !== "no" })
    .eq("id", id)
    .eq("company_id", company.id);
  if (error) fail("/branches", error.message);
  revalidatePath("/branches");
  redirect(withNotice("/branches", { msg: "Branch saved." }));
}

export async function removeBranch(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("branches").delete().eq("id", str(form, "id")).eq("company_id", company.id);
  if (error) fail("/branches", error.message);
  revalidatePath("/branches");
  redirect(withNotice("/branches", { msg: "Branch removed." }));
}

/** Stores and people: one form with a branch for each. Only the ones that changed are saved. */
export async function assignBranches(form: FormData) {
  const { supabase, company } = await getAppContext();
  for (const [key, raw] of form.entries()) {
    if (typeof raw !== "string" || key.startsWith("was:")) continue;
    const branch = raw === "" ? null : raw;
    const [kind, id] = key.split(":");
    if (!id || form.get(`was:${kind}:${id}`) === raw) continue;
    if (kind === "store") {
      const { error } = await supabase.from("warehouses").update({ branch_id: branch }).eq("id", id).eq("company_id", company.id);
      if (error) fail("/branches", error.message);
    } else if (kind === "member") {
      const { error } = await supabase.rpc("set_member_branch", { p_membership: id, p_branch: branch });
      if (error) fail("/branches", error.message);
    }
  }
  revalidatePath("/branches");
  redirect(withNotice("/branches", { msg: "Saved. New documents from these people go to their branch." }));
}

export async function moveToBranch(form: FormData) {
  const kind = str(form, "kind") as BranchDoc;
  const doc = BRANCH_DOCS[kind];
  const id = str(form, "id");
  if (!doc || !id) redirect("/");
  const path = `${doc.path}${id}`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("set_document_branch", { p_kind: kind, p_id: id, p_branch: optional(form, "branch_id") });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Moved to the branch." }));
}
