"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { inboxAdmin } from "@/lib/inbox/server";
import { fromLocalInput } from "@/lib/services";

export type RequestState = { ok?: boolean; error?: string };

/**
 * A client or supplier asks for a meeting from the public request page. Protected three ways: a hidden field
 * people never fill (bots do), a minimum time on the page, and the database's limit per sender (three an hour)
 * and per company (40 a day). The sender is a salted hash of their address, never stored as is. Everything is
 * checked again in public.meeting_portal_request (service role only).
 */
export async function submitRequest(_prev: RequestState, form: FormData): Promise<RequestState> {
  const token = String(form.get("token") ?? "");
  const get = (k: string) => String(form.get(k) ?? "").trim();
  if (!/^[0-9a-f]{40,64}$/.test(token)) return { error: "This page does not work." };
  // The hidden field: a person never fills it. Pretend it worked.
  if (get("website")) return { ok: true };
  const shownAt = Number(get("t"));
  if (!Number.isFinite(shownAt) || Date.now() - shownAt < 3000) return { error: "Please check the details and send again." };
  const db = inboxAdmin();
  if (!db) return { error: "Requests are not available right now. Please email us instead." };

  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  // No built-in salt: without a server secret the page is off (and says so in the server log).
  const salt = process.env.MEETING_REQUEST_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) {
    console.error("meet/request: MEETING_REQUEST_SALT (or SUPABASE_SERVICE_ROLE_KEY) is not set; requests are off");
    return { error: "Requests are not available right now. Please email us instead." };
  }
  const sender = createHash("sha256").update(`${salt}|${ip || get("email").toLowerCase()}`).digest("hex");

  const proposed = fromLocalInput(get("proposed_at"));
  if (!proposed) return { error: "Choose a date and time." };
  const { data, error } = await db.rpc("meeting_portal_request", {
    p_token: token,
    p: {
      name: get("name").slice(0, 120),
      company: get("company").slice(0, 160),
      email: get("email").slice(0, 200),
      phone: get("phone").slice(0, 20),
      topic: get("topic").slice(0, 200),
      message: get("message").slice(0, 2000),
      proposed_at: proposed,
      minutes: get("minutes"),
      link: get("link").slice(0, 500),
    },
    p_sender: sender,
  });
  if (error) return { error: "Something went wrong. Please try again later." };
  const r = data as { status: string; error?: string };
  if (r.status === "received") return { ok: true };
  if (r.status === "limited") return { error: "Too many requests. Please try again in an hour." };
  if (r.status === "closed") return { error: "This page is closed. Please contact the company directly." };
  return { error: r.error ?? "Please check the details." };
}
