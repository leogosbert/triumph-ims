"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { str, choice, LOST_CHOICE } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { portalLoginUrl, sendPortalEmail } from "@/lib/portal/server";
import { siteUrl } from "@/lib/supabase/env";

/** Only paths inside the app (the form says where to come back to). */
const backTo = (form: FormData, fallback: string) => {
  const b = str(form, "back");
  return b.startsWith("/") && !b.startsWith("//") ? b : fallback;
};

/** Management invites a client's or supplier's contact to the portal and emails them the sign-in page. */
export async function inviteToPortal(form: FormData) {
  const { supabase, company } = await getAppContext();
  const party = str(form, "party") === "supplier" ? "supplier" : "client";
  const partyId = str(form, "party_id");
  const back = backTo(form, `/${party === "client" ? "clients" : "suppliers"}/${partyId}#portal`);
  const email = str(form, "email").toLowerCase();
  const name = str(form, "name");
  const { error } = await supabase.rpc("portal_invite", {
    p_company: company.id,
    p_party: party,
    p_party_id: partyId,
    p_email: email,
    p_name: name,
    p_position: str(form, "position") || null,
    p_phone: str(form, "phone") || null,
    p_contact: str(form, "contact_id") || null,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  const what = party === "client" ? "quotations, orders, deliveries, invoices and documents" : "requests for prices, purchase orders, delivery notes and invoices";
  const sent = await sendPortalEmail({
    to: email,
    fromName: company.name.slice(0, 80),
    subject: `${company.name} invited you to their ${party} portal`,
    lines: [
      `Hello ${name.split(/\s+/)[0]},`,
      `${company.name} has opened a ${party} portal for you. There you see your ${what} in one place, at any time.`,
      "Sign in with this email address: you receive a one-time code each time. No password is needed.",
    ],
    button: { label: "Open the portal", url: portalLoginUrl(company.id, email) },
  });
  revalidatePath(back.split("#")[0]);
  redirect(
    withNotice(back, sent.ok ? { msg: `Invited ${email} to the portal.` } : { msg: `Access given to ${email}, but the invitation email was not sent. Send them the link: ${portalLoginUrl(company.id)}` }),
  );
}

export async function revokePortal(form: FormData) {
  const { supabase } = await getAppContext();
  const back = backTo(form, "/portal-admin");
  const { error } = await supabase.rpc("portal_revoke", { p_portal_user: str(form, "id") });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back.split("#")[0]);
  redirect(withNotice(back, { msg: "Portal access removed. They are signed out." }));
}

export async function shareDocument(form: FormData) {
  const { supabase } = await getAppContext();
  const back = backTo(form, "/portal-admin");
  const { error } = await supabase.rpc("portal_share_document", {
    p_document: str(form, "document_id"),
    p_party: str(form, "party") === "supplier" ? "supplier" : "client",
    p_party_id: str(form, "party_id"),
    p_share: str(form, "share") === "true",
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back.split("#")[0]);
  redirect(withNotice(back, { msg: str(form, "share") === "true" ? "Shared on their portal." : "No longer shown on their portal." }));
}

/** Management approves or rejects new bank details; the supplier's portal contacts get an email either way. */
export async function decideBankChange(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const back = `/portal-admin/bank/${id}`;
  const approve = choice(form, "approve", "true", "false");
  if (approve === null) redirect(withNotice(back, { error: LOST_CHOICE }));
  const { data, error } = await supabase.rpc("portal_decide_bank_change", { p_id: id, p_approve: approve, p_note: str(form, "note") || null });
  if (error || !data) redirect(withNotice(back, { error: friendlyError(error?.message) }));
  const r = data as { supplier: string | null; status: string; note: string | null; emails: string[] };
  await Promise.all(
    (r.emails ?? []).map((to) =>
      sendPortalEmail({
        to,
        fromName: company.name.slice(0, 80),
        subject: approve ? `${company.name} approved your new bank details` : `${company.name} did not approve your new bank details`,
        lines: approve
          ? [`Your new bank details for ${r.supplier ?? "your company"} are approved. We pay to the new account from now on.`]
          : [`Your new bank details for ${r.supplier ?? "your company"} were not approved.`, r.note ? `Reason: ${r.note}` : "", "We keep paying to the account we had. Contact us if you have questions."],
        button: { label: "Open the portal", url: `${siteUrl()}/portal/company` },
      }),
    ),
  );
  revalidatePath("/portal-admin");
  redirect(withNotice(back, { msg: approve ? "Bank details approved. The supplier was told." : "Bank details rejected. The supplier was told." }));
}

/** Finance checks a document from the supplier portal: make a bill, mark it checked, or send it back. */
export async function reviewSubmission(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const back = `/portal-admin/submissions/${id}`;
  const action = str(form, "action");
  const { data, error } = await supabase.rpc("portal_review_submission", {
    p_id: id,
    p_action: action,
    p_note: str(form, "note") || null,
    p_due: str(form, "due_date") || null,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  if (action === "reject") {
    const { data: s } = await supabase
      .from("portal_submissions")
      .select("kind, supplier_invoice_no, reference, review_note, portal_user:portal_users(email, status)")
      .eq("id", id)
      .eq("company_id", company.id)
      .maybeSingle();
    const pu = (s as unknown as { portal_user: { email: string; status: string } | null } | null)?.portal_user;
    if (s && pu?.status === "active") {
      await sendPortalEmail({
        to: pu.email,
        fromName: company.name.slice(0, 80),
        subject: `${company.name} sent back your ${s.kind === "invoice" ? `invoice ${s.supplier_invoice_no ?? ""}` : "delivery note"}`.trim(),
        lines: [`We could not accept the ${s.kind === "invoice" ? `invoice ${s.supplier_invoice_no ?? ""}` : `delivery note ${s.reference ?? ""}`} you sent through the portal.`, s.review_note ? `Reason: ${s.review_note}` : "", "Please send a corrected one from the portal."],
        button: { label: "Open the portal", url: `${siteUrl()}/portal/send` },
      });
    }
  }
  revalidatePath("/portal-admin");
  if (action === "bill" && typeof data === "string") redirect(withNotice(`/bills/${data}`, { msg: "Draft bill made from the supplier's invoice. Check it and approve it." }));
  redirect(withNotice(back, { msg: action === "reject" ? "Sent back to the supplier." : "Marked as checked." }));
}

/** "Send via portal" on a supplier RFQ: emails each invited supplier's portal contacts a link to answer online. */
export async function sendRfqViaPortal(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const back = `/supplier-rfqs/${id}`;
  const { data, error } = await supabase.rpc("portal_rfq_send_list", { p_srfq: id });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  const list = (data ?? []) as { srfq_supplier_id: string; supplier: string; recipients: { name: string; email: string }[] }[];
  const { data: rfq } = await supabase.from("supplier_rfqs").select("number, title, due_on").eq("id", id).eq("company_id", company.id).maybeSingle();
  let sent = 0;
  const missing: string[] = [];
  for (const row of list) {
    if (row.recipients.length === 0) missing.push(row.supplier);
    for (const p of row.recipients) {
      const r = await sendPortalEmail({
        to: p.email,
        fromName: company.name.slice(0, 80),
        subject: `Request for prices ${rfq?.number ?? ""} from ${company.name}`.replace(/\s+/g, " "),
        lines: [
          `Hello ${p.name.split(/\s+/)[0]},`,
          `${company.name} asks ${row.supplier} for prices${rfq?.title ? ` for ${rfq.title}` : ""}.${rfq?.due_on ? ` Please answer by ${rfq.due_on}.` : ""}`,
          "Enter your prices, lead time and validity on the supplier portal, and attach your quotation if you like.",
        ],
        button: { label: "Answer on the portal", url: `${siteUrl()}/portal/rfqs/${row.srfq_supplier_id}` },
      });
      if (r.ok) sent += 1;
    }
  }
  const parts = [`Sent to ${sent} portal contact${sent === 1 ? "" : "s"}.`];
  if (missing.length) parts.push(`No portal access yet: ${missing.join(", ")}. Invite them from the supplier page.`);
  redirect(withNotice(back, sent > 0 ? { msg: parts.join(" ") } : { error: list.length === 0 ? "No supplier is waiting to answer." : parts.join(" ") }));
}
