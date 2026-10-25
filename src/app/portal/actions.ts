"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/supabase/env";
import {
  call,
  clearPortalCookies,
  clientIp,
  portalDb,
  portalMessage,
  portalRpc,
  readSession,
  requireParty,
  requirePortal,
  sendPortalEmail,
  setAccountCookie,
  setSessionCookie,
  userAgent,
} from "@/lib/portal/server";
import type { PortalAccountRow } from "@/lib/portal/types";

export type ActionResult = { ok?: string; error?: string; id?: string };

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------------------------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------------------------

/** Step 1: email the sign-in link and code. The answer never says whether the email has access. */
export async function requestCode(email: string): Promise<ActionResult> {
  if (!portalDb()) return { error: "The portal is not set up on the server yet." };
  let r: { status: string; token?: string; code?: string; email?: string; companies?: string[] };
  try {
    r = await portalRpc("portal_request_login", { p_email: email, p_ip: await clientIp() });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  if (r.status === "invalid") return { error: "Enter a valid email address." };
  if (r.status === "limited") return { error: "Too many sign-in requests. Please wait 15 minutes and try again." };
  if (r.status === "sent" && r.token && r.code && r.email) {
    const from = (r.companies ?? []).join(", ") || "Portal";
    const link = `${siteUrl()}/portal/auth?t=${r.token}`;
    const sent = await sendPortalEmail({
      to: r.email,
      fromName: from.slice(0, 80),
      subject: `${r.code} is your sign-in code`,
      lines: [
        `Your sign-in code for the ${from} portal is ${r.code}.`,
        "Type it on the sign-in page, or press the button below. The code and the button work once, for 15 minutes.",
        "If you did not ask to sign in, you can ignore this email.",
      ],
      button: { label: "Sign in to the portal", url: link },
    });
    if (process.env.NODE_ENV !== "production") console.info(`[portal] sign-in code for ${r.email}: ${r.code} · ${link}`);
    if (!sent.ok && process.env.NODE_ENV === "production") {
      return { error: "We could not send the email just now. Please try again in a few minutes." };
    }
  }
  return { ok: "If this email has access to a portal, we have sent a sign-in link and a 6-digit code to it. It works for 15 minutes." };
}

async function startSession(r: { status: string; session?: string }): Promise<ActionResult> {
  if (r.status === "limited") return { error: "Too many wrong codes. Please wait 15 minutes and try again." };
  if (r.status === "none") return { error: "This email no longer has portal access. Ask your contact at the company." };
  if (r.status !== "ok" || !r.session) return { error: "The code is wrong or has expired. Ask for a new one." };
  await setSessionCookie(r.session);
  // One account: straight in. Several (the same person at several companies): choose.
  try {
    const accounts = await portalRpc<PortalAccountRow[]>("portal_accounts", { p_session: r.session });
    if (accounts.length === 1) {
      await setAccountCookie(accounts[0].id);
      return { ok: "/portal/home" };
    }
  } catch {
    /* fall through to the chooser */
  }
  return { ok: "/portal/choose" };
}

/** Step 2: the 6-digit code. ok holds the page to open next. */
export async function verifyCode(email: string, code: string): Promise<ActionResult> {
  try {
    const r = await portalRpc<{ status: string; session?: string }>("portal_verify_login", {
      p_email: email,
      p_code: code,
      p_token: null,
      p_ip: await clientIp(),
      p_agent: await userAgent(),
    });
    return startSession(r);
  } catch (e) {
    return { error: portalMessage(e) };
  }
}

/** The link from the email (posted from /portal/auth, so mail scanners that open links do not use it up). */
export async function verifyLink(form: FormData) {
  const token = s(form, "t");
  let next = "/portal/login?error=link";
  try {
    const r = await portalRpc<{ status: string; session?: string }>("portal_verify_login", {
      p_email: null,
      p_code: null,
      p_token: token,
      p_ip: await clientIp(),
      p_agent: await userAgent(),
    });
    const res = await startSession(r);
    next = res.ok ?? `/portal/login?error=${r.status === "limited" ? "limited" : r.status === "none" ? "none" : "link"}`;
  } catch {
    next = "/portal/login?error=link";
  }
  redirect(next);
}

export async function chooseAccount(form: FormData) {
  const id = s(form, "account");
  const { session } = await readSession();
  if (!session) redirect("/portal/login");
  const accounts = await portalRpc<PortalAccountRow[]>("portal_accounts", { p_session: session }).catch(() => [] as PortalAccountRow[]);
  if (!accounts.some((a) => a.id === id)) redirect("/portal/choose");
  await setAccountCookie(id);
  redirect("/portal/home");
}

export async function signOut() {
  const { session } = await readSession();
  if (session) await portalRpc("portal_sign_out", { p_session: session }).catch(() => undefined);
  await clearPortalCookies();
  redirect("/portal/login?msg=signed_out");
}

// ---------------------------------------------------------------------------------------------
// Client portal
// ---------------------------------------------------------------------------------------------

/** Accept or decline a quotation online. */
export async function decideQuotation(id: string, input: {
  decision: "accept" | "decline";
  name: string;
  position: string;
  signature_kind: "typed" | "drawn" | null;
  signature_text: string;
  signature_image: string;
  reason: string;
  po_ref: string;
}): Promise<ActionResult> {
  const ctx = await requireParty("client");
  if (input.signature_image && input.signature_image.length > 300000) return { error: "The signature drawing is too large. Clear it and sign again." };
  try {
    await call(ctx, "portal_decide_quotation", {
      p_id: id,
      p: { ...input, ip: await clientIp(), agent: await userAgent() },
    });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  revalidatePath("/portal", "layout");
  return { ok: input.decision === "accept" ? "Thank you. The quotation is accepted and our team has been told." : "Thank you. We have noted that you declined this quotation." };
}

export async function sendMessage(form: FormData): Promise<ActionResult> {
  const ctx = await requirePortal();
  try {
    await call(ctx, "portal_send_message", { p_text: s(form, "text"), p_subject: s(form, "subject") || null });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  revalidatePath("/portal/messages");
  return { ok: "Message sent. We will answer here." };
}

// ---------------------------------------------------------------------------------------------
// Supplier portal
// ---------------------------------------------------------------------------------------------

export async function answerRfq(id: string, input: {
  decline: boolean;
  currency: string;
  lead_time_days: string;
  valid_until: string;
  payment_terms: string;
  incoterms: string;
  freight: string;
  supplier_ref: string;
  notes: string;
  lines: { line_id: string; unit_price: string; notes: string }[];
}): Promise<ActionResult> {
  const ctx = await requireParty("supplier");
  try {
    await call(ctx, "portal_answer_rfq", { p_id: id, p: input });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  revalidatePath("/portal", "layout");
  return { ok: input.decline ? "Thank you. We have noted that you cannot quote." : "Thank you. Your prices have reached our purchasing team." };
}

export async function confirmPo(form: FormData): Promise<ActionResult> {
  const ctx = await requireParty("supplier");
  try {
    await call(ctx, "portal_confirm_po", { p_id: s(form, "id"), p_supplier_ref: s(form, "supplier_ref") || null, p_expected: s(form, "expected_date") || null });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  revalidatePath("/portal", "layout");
  return { ok: "Purchase order confirmed. Thank you." };
}

/** A delivery note or an invoice; files are uploaded next with startUpload/finishUpload. */
export async function submitDocument(input: Record<string, string>): Promise<ActionResult> {
  const ctx = await requireParty("supplier");
  try {
    const id = await call<string>(ctx, "portal_submit_document", { p: input });
    return { ok: "sent", id };
  } catch (e) {
    return { error: portalMessage(e) };
  }
}

export type UploadSlot = { id: string; path: string; token: string } | { error: string };

/**
 * Asks the database for a place for one file (checked against the signed-in supplier), then a
 * one-time upload address so the browser sends the file straight to storage (no size limit of the
 * server in between). The file is shown only after finishUpload confirms it arrived.
 */
export async function startUpload(meta: {
  purpose: string;
  file_name: string;
  content_type: string;
  size: number;
  srfq_supplier_id?: string;
  submission_id?: string;
  bank_detail_id?: string;
  title?: string;
  reference?: string;
  expires_on?: string;
}): Promise<UploadSlot> {
  const ctx = await requireParty("supplier");
  const db = portalDb();
  if (!db) return { error: "The portal is not set up on the server yet." };
  try {
    const slot = await call<{ id: string; path: string }>(ctx, "portal_file_begin", { p: { ...meta, size: String(meta.size) } });
    const { data, error } = await db.storage.from("portal").createSignedUploadUrl(slot.path);
    if (error || !data) return { error: "The file could not be prepared. Please try again." };
    return { id: slot.id, path: slot.path, token: data.token };
  } catch (e) {
    return { error: portalMessage(e) };
  }
}

export async function finishUpload(fileId: string): Promise<ActionResult> {
  const ctx = await requireParty("supplier");
  try {
    await call(ctx, "portal_file_done", { p_file: fileId });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  revalidatePath("/portal", "layout");
  return { ok: "File received." };
}

export async function updateSupplier(form: FormData): Promise<ActionResult> {
  const ctx = await requireParty("supplier");
  try {
    await call(ctx, "portal_update_supplier", {
      p: { tax_no: s(form, "tax_no"), phone: s(form, "phone"), city: s(form, "city"), country: s(form, "country"), certificates: s(form, "certificates") },
    });
  } catch (e) {
    return { error: portalMessage(e) };
  }
  revalidatePath("/portal/company");
  return { ok: "Your details are saved and our team has been told." };
}

export async function requestBankChange(input: Record<string, string>): Promise<ActionResult> {
  const ctx = await requireParty("supplier");
  try {
    const id = await call<string>(ctx, "portal_request_bank_change", { p: input });
    revalidatePath("/portal/company");
    return { ok: "sent", id };
  } catch (e) {
    return { error: portalMessage(e) };
  }
}
