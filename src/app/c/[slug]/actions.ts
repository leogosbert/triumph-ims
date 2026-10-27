"use server";

import { headers } from "next/headers";
import { checkEnquiryForm, clientIp, senderHash, SLUG_RE } from "@/lib/growth-tools/catalogue";
import { inboxAdmin } from "@/lib/inbox/server";

export type EnquiryState = { status: "idle" | "sent" | "error"; message: string };

/**
 * A visitor's enquiry or request for quotation (no sign-in). Checked here (honeypot, timing, fields),
 * then by the database (catalogue_enquiry: rate limit, products still public, the Inbox, the RFQ and the
 * notification). Only a hash of the visitor's address is kept, for the rate limit.
 */
export async function sendEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  const slug = String(form.get("slug") ?? "");
  if (!SLUG_RE.test(slug)) return { status: "error", message: "This catalogue is not available." };
  const check = checkEnquiryForm(form);
  // A robot filled the hidden field or sent the form at once: answer as if it worked, save nothing.
  if (!check.ok && check.spam && check.error === "Sent.") return { status: "sent", message: "Thank you. We will reply soon." };
  if (!check.ok) return { status: "error", message: check.error };
  const admin = inboxAdmin();
  if (!admin) return { status: "error", message: "Requests cannot be received right now. Please call or email us." };
  const h = await headers();
  const hash = senderHash(clientIp(h), h.get("user-agent") ?? "");
  if (!hash) return { status: "error", message: "Requests cannot be received right now. Please call or email us." };
  const v = check.value;
  const { data, error } = await admin.rpc("catalogue_enquiry", {
    p_slug: slug,
    p: { kind: v.kind, name: v.name, company: v.company, email: v.email, phone: v.phone, message: v.message, lines: v.lines },
    p_sender: hash,
  });
  if (error) return { status: "error", message: "Your request could not be sent. Please try again, or call or email us." };
  const r = (data ?? {}) as { status?: string; error?: string };
  if (r.status === "received") return { status: "sent", message: v.kind === "quote" ? "Thank you. Your request for quotation is with our sales team; we will reply soon." : "Thank you. We will reply soon." };
  if (r.status === "limited") return { status: "error", message: "You have sent several requests already. Please wait an hour, or call or email us." };
  if (r.status === "invalid") return { status: "error", message: r.error ?? "Please check the form." };
  return { status: "error", message: "This catalogue is not available." };
}
