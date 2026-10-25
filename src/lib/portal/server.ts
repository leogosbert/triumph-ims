import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SUPABASE_URL, siteUrl } from "@/lib/supabase/env";
import { mailboxAddress, mailboxConfig } from "@/lib/inbox/mailbox";
import { sendEmailReply } from "@/lib/inbox/server";
import { brandForCompany } from "@/lib/brands";
import type { PortalMe } from "./types";

/**
 * Server-only code of the client and supplier portal (/portal/**).
 *
 * Portal people are not app users: they have no Supabase Auth account. The portal pages talk to the
 * database only through the portal_* functions (supabase/migrations/20261027000201_portal.sql) with the
 * service role key, passing the portal session token from an httpOnly cookie. Each function checks the
 * session and the chosen portal account and only returns that client's or supplier's records.
 * Never import this file from a "use client" file: SUPABASE_SERVICE_ROLE_KEY must stay on the server.
 *
 * Settings (Netlify → Site configuration → Environment variables):
 *   SUPABASE_SERVICE_ROLE_KEY   required (also used by the Inbox webhooks)
 *   RESEND_API_KEY, EMAIL_FROM  send the sign-in links and codes (or the company mailbox, SMTP_*)
 *   NEXT_PUBLIC_SITE_URL        the address in the emails, e.g. https://app.triumph.co.tz
 */

/** Cookies live on /portal only, so the app never receives them (and the portal never sees the app's). */
export const SESSION_COOKIE = "portal_session";
export const ACCOUNT_COOKIE = "portal_account";
const COOKIE_PATH = "/portal";
const SESSION_DAYS = 7;

let admin: SupabaseClient | null = null;

/** The portal's database client (service role). Null when the key is not set. */
export function portalDb(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL) return null;
  admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export function portalReady(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL);
}

export class PortalError extends Error {
  constructor(
    message: string,
    public code: string | undefined,
  ) {
    super(message);
  }
}

/** Calls a portal_* function. Throws PortalError with the database's plain message. */
export async function portalRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const db = portalDb();
  if (!db) throw new PortalError("The portal is not set up on the server yet.", "setup");
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new PortalError(error.message, error.code);
  return data as T;
}

/** The person's address as the hosting platform reports it (for rate limits and the Activity log). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const raw = h.get("x-nf-client-connection-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "";
  return raw.trim().slice(0, 64) || "unknown";
}

export async function userAgent(): Promise<string> {
  return ((await headers()).get("user-agent") ?? "").slice(0, 300);
}

const cookieBase = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: COOKIE_PATH,
});

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_DAYS * 24 * 3600 });
}

export async function setAccountCookie(id: string) {
  (await cookies()).set(ACCOUNT_COOKIE, id, { ...cookieBase(), maxAge: SESSION_DAYS * 24 * 3600 });
}

export async function clearPortalCookies() {
  const c = await cookies();
  c.set(SESSION_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  c.set(ACCOUNT_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

export async function readSession(): Promise<{ session: string | null; account: string | null }> {
  const c = await cookies();
  const session = c.get(SESSION_COOKIE)?.value ?? null;
  const account = c.get(ACCOUNT_COOKIE)?.value ?? null;
  return {
    session: session && /^[0-9a-f]{64}$/.test(session) ? session : null,
    account: account && /^[0-9a-f-]{36}$/i.test(account) ? account : null,
  };
}

export type PortalContext = { session: string; account: string; me: PortalMe };

/**
 * The signed-in portal account for this request, or a redirect to sign in (or to choose an account).
 * Cached per request, so the layout and the page share one database call.
 */
export const requirePortal = cache(async (): Promise<PortalContext> => {
  if (!portalReady()) redirect("/portal/login?error=setup");
  const { session, account } = await readSession();
  if (!session) redirect("/portal/login");
  if (!account) redirect("/portal/choose");
  try {
    const me = await portalRpc<PortalMe>("portal_me", { p_session: session, p_account: account });
    return { session, account, me };
  } catch (e) {
    const code = e instanceof PortalError ? e.code : undefined;
    if (code === "28000") redirect("/portal/login?expired=1");
    redirect("/portal/choose");
  }
});

/** Same as requirePortal, for one side only (a supplier opening a client page goes home). */
export async function requireParty(party: "client" | "supplier"): Promise<PortalContext> {
  const ctx = await requirePortal();
  if (ctx.me.account.party !== party) redirect("/portal/home");
  return ctx;
}

/** Calls a portal function for the signed-in account. */
export async function call<T>(ctx: PortalContext, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return portalRpc<T>(fn, { p_session: ctx.session, p_account: ctx.account, ...args });
}

/** The public address of the portal sign-in page, with the company's brand when it has one. */
export function portalLoginUrl(companyId: string | null, email?: string | null): string {
  const b = brandForCompany(companyId);
  const p = new URLSearchParams();
  if (b) p.set("b", b.key);
  if (email) p.set("email", email);
  const q = p.toString();
  return `${siteUrl()}/portal/login${q ? `?${q}` : ""}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type PortalMail = { to: string; subject: string; lines: string[]; button?: { label: string; url: string }; fromName: string };

/** Sends a portal email (sign-in code, invitation, decision). Uses the company mailbox when set, else Resend. */
export async function sendPortalEmail(m: PortalMail): Promise<{ ok: boolean; error?: string }> {
  const text = [...m.lines, ...(m.button ? ["", `${m.button.label}: ${m.button.url}`] : [])].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#14213a;max-width:520px">${m.lines
    .map((l) => (l ? `<p style="margin:0 0 12px">${esc(l)}</p>` : ""))
    .join("")}${
    m.button
      ? `<p style="margin:20px 0"><a href="${esc(m.button.url)}" style="background:#1c4c9b;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${esc(m.button.label)}</a></p>`
      : ""
  }</div>`;
  const mailbox = mailboxAddress(mailboxConfig());
  const sent = await sendEmailReply(
    { to: [m.to], cc: [], subject: m.subject, text, html, replyTo: null, fromName: m.fromName, inReplyTo: null, references: [] },
    mailbox,
  );
  if (!sent.ok) {
    if (process.env.NODE_ENV !== "production") console.warn(`[portal] email to ${m.to} not sent: ${sent.error}\n${text}`);
    return { ok: false, error: sent.error };
  }
  return { ok: true };
}

/** Friendly words for errors the database sends back. */
export function portalMessage(e: unknown): string {
  if (e instanceof PortalError) {
    if (e.code === "setup") return e.message;
    if (e.code === "28000") return "Please sign in again.";
    // Our own messages (raise exception '...') are plain sentences; anything else is hidden.
    if (["22023", "42501", "23505", "P0001"].includes(e.code ?? "") && e.message.length < 300) return e.message;
    if (e.code === "22P02") return "Something in the form is not valid. Please check it.";
  }
  return "Something went wrong. Please try again.";
}
