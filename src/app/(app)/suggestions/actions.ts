"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { CATEGORY_KEYS, isMissingSql, STAGE11_MISSING } from "@/components/suggestions/meta";

type DbError = { code?: string | null; message?: string | null } | null;

function explain(error: DbError): string {
  if (isMissingSql(error)) return STAGE11_MISSING;
  return friendlyError(error?.message);
}

function refresh(id?: string) {
  revalidatePath("/suggestions");
  revalidatePath("/notifications");
  if (id) revalidatePath(`/suggestions/${id}`);
}

function detail(id: string, anchor = "") {
  return `/suggestions/${id}${anchor}`;
}

/** Ids come from hidden fields: only accept something shaped like a uuid. */
function uuid(v: string): string | null {
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

function checkText(from: string, category: string, title: string, body: string) {
  if (!CATEGORY_KEYS.includes(category)) redirect(withNotice(from, { error: "Choose a category." }));
  if (title.length < 3) redirect(withNotice(from, { error: "Give your suggestion a short title (at least 3 letters)." }));
  if (title.length > 140) redirect(withNotice(from, { error: "The title is too long (140 letters at most)." }));
  if (body.length > 4000) redirect(withNotice(from, { error: "The details are too long (4,000 letters at most)." }));
}

/** New suggestion from any team member, or an internal improvement from management. */
export async function submitSuggestion(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  const from = "/suggestions/new";
  const category = str(form, "category");
  const title = str(form, "title");
  const body = str(form, "body");
  checkText(from, category, title, body);

  const internal = isManager && form.get("internal") === "on";
  let result: { data: unknown; error: DbError };
  if (internal) {
    const assignTo = uuid(str(form, "assign_to"));
    result = await supabase.rpc("create_improvement", {
      p_company: company.id,
      p_category: category,
      p_title: title,
      p_body: body,
      p_assign_to: assignTo,
      p_department: optional(form, "department"),
    });
  } else {
    result = await supabase.rpc("submit_suggestion", {
      p_company: company.id,
      p_category: category,
      p_title: title,
      p_body: body,
      p_about_app: form.get("about_app") === "on",
    });
  }
  if (result.error) redirect(withNotice(from, { error: explain(result.error) }));
  const id = String(result.data ?? "");
  refresh(id);
  redirect(
    withNotice(id ? detail(id) : "/suggestions", {
      msg: internal ? "Improvement created." : "Thank you! Your suggestion has been sent to management.",
    }),
  );
}

const MANAGER_STATUSES = ["under_review", "needs_clarification", "approved", "rejected", "assigned", "implemented", "archived"];

/** Management decision on a suggestion. */
export async function reviewSuggestion(form: FormData) {
  const { supabase, isManager } = await getAppContext();
  const id = uuid(str(form, "id"));
  if (!id) redirect("/suggestions");
  if (!isManager) redirect(withNotice(detail(id), { error: "Only management can review suggestions." }));
  const status = str(form, "status");
  let note = optional(form, "note");
  if (!MANAGER_STATUSES.includes(status)) redirect(withNotice(detail(id), { error: "Choose what to do with this suggestion." }));
  if ((status === "needs_clarification" || status === "rejected") && !note) {
    redirect(
      withNotice(detail(id, "#decide"), {
        error:
          status === "rejected"
            ? "Please write a short note explaining why it is not taken forward."
            : "Please write what needs to be clarified.",
      }),
    );
  }
  if (note && note.length > 2000) redirect(withNotice(detail(id, "#decide"), { error: "The note is too long (2,000 letters at most)." }));

  let assignTo: string | null = null;
  const department = optional(form, "department");
  if (status === "assigned") {
    assignTo = uuid(str(form, "assign_to"));
    if (!assignTo) redirect(withNotice(detail(id, "#assign"), { error: "Choose the team member to assign it to." }));
  }

  const args: Record<string, unknown> = { p_id: id, p_status: status, p_note: note, p_assign_to: assignTo };
  let { error } = await supabase.rpc("review_suggestion", department ? { ...args, p_department: department } : args);
  // The contract's review_suggestion has no department parameter: keep the department in the note instead.
  if (error && department && (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? ""))) {
    note = note ? `${note}\nDepartment: ${department}` : `Department: ${department}`;
    ({ error } = await supabase.rpc("review_suggestion", { ...args, p_note: note }));
  }
  if (error) redirect(withNotice(detail(id, "#decide"), { error: explain(error) }));
  refresh(id);
  redirect(withNotice(detail(id), { msg: "Suggestion updated. The author has been told." }));
}

/** The person a suggestion is assigned to reports progress. */
export async function updateMyAssignment(form: FormData) {
  const { supabase } = await getAppContext();
  const id = uuid(str(form, "id"));
  if (!id) redirect("/suggestions");
  const status = str(form, "status");
  if (status !== "under_review" && status !== "implemented") redirect(withNotice(detail(id), { error: "Choose an update." }));
  const note = optional(form, "note");
  const { error } = await supabase.rpc("update_my_assignment", { p_id: id, p_status: status, p_note: note });
  if (error) redirect(withNotice(detail(id, "#mywork"), { error: explain(error) }));
  refresh(id);
  redirect(withNotice(detail(id), { msg: status === "implemented" ? "Marked as implemented. Well done!" : "Progress saved." }));
}

/** The author answers a request for clarification. */
export async function resubmitSuggestion(form: FormData) {
  const { supabase } = await getAppContext();
  const id = uuid(str(form, "id"));
  if (!id) redirect("/suggestions");
  const body = str(form, "body");
  if (!body) redirect(withNotice(detail(id, "#clarify"), { error: "Please add the clarification." }));
  if (body.length > 4000) redirect(withNotice(detail(id, "#clarify"), { error: "The details are too long (4,000 letters at most)." }));
  const { error } = await supabase.rpc("resubmit_suggestion", { p_id: id, p_body: body });
  if (error) redirect(withNotice(detail(id, "#clarify"), { error: explain(error) }));
  refresh(id);
  redirect(withNotice(detail(id), { msg: "Sent again to management." }));
}

export async function commentSuggestion(form: FormData) {
  const { supabase } = await getAppContext();
  const id = uuid(str(form, "id"));
  if (!id) redirect("/suggestions");
  const body = str(form, "body");
  if (!body) redirect(withNotice(detail(id, "#comments"), { error: "Write a comment first." }));
  if (body.length > 2000) redirect(withNotice(detail(id, "#comments"), { error: "The comment is too long (2,000 letters at most)." }));
  const { error } = await supabase.rpc("comment_suggestion", { p_id: id, p_body: body });
  if (error) redirect(withNotice(detail(id, "#comments"), { error: explain(error) }));
  refresh(id);
  redirect(withNotice(detail(id, "#comments"), { msg: "Comment added." }));
}
