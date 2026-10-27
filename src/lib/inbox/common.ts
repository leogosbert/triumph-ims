import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type Role, type RoleSet } from "@/lib/roles";

/** Who uses the shared inbox. Mirrors public.inbox_roles() in the database (the real guard). */
export const INBOX_ROLES: Role[] = ["management", "sales", "procurement", "finance"];
export const canUseInbox = (role: RoleSet) => hasRole(role, ...INBOX_ROLES);

export type Channel = "email" | "whatsapp" | "portal";

export type Conversation = {
  id: string;
  company_id: string;
  ref: string;
  channel: Channel;
  subject: string | null;
  counterpart_address: string;
  counterpart_name: string | null;
  client_id: string | null;
  supplier_id: string | null;
  status: "open" | "closed";
  assigned_to: string | null;
  unread_count: number;
  message_count: number;
  preview: string | null;
  last_direction: "in" | "out" | null;
  last_message_at: string;
  closed_at: string | null;
  created_at: string;
};

export type InboxMessage = {
  id: string;
  conversation_id: string;
  channel: Channel;
  direction: "in" | "out";
  status: "received" | "sent" | "manual" | "failed";
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  provider: string;
  email_message_id: string | null;
  in_reply_to: string | null;
  reference_ids: string[];
  error: string | null;
  sent_by: string | null;
  created_at: string;
};

export type InboxSettings = {
  company_id: string;
  inbound_address: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_display_phone: string | null;
  reply_name: string | null;
  signature: string | null;
};

/**
 * For a badge in the menu: open conversations with unread messages. 0 when the inbox
 * SQL has not been run, the person's role has no inbox, or anything goes wrong.
 */
export async function getInboxUnreadCount(supabase: SupabaseClient, companyId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("inbox_unread_count", { p_company: companyId });
    return error ? 0 : Number(data ?? 0);
  } catch {
    return 0;
  }
}

/** The reply-to address that brings answers back to this conversation: alias+<ref>@domain. */
export function replyToAddress(inbound: string | null | undefined, ref: string): string | null {
  if (!inbound) return null;
  const at = inbound.lastIndexOf("@");
  if (at < 1) return null;
  return `${inbound.slice(0, at)}+${ref}${inbound.slice(at)}`;
}

/** A suggested inbox address for a company: <name>-<4 random>@<domain>. */
export function suggestInboxAddress(companyName: string, domain: string | null): string | null {
  if (!domain) return null;
  const slug = companyName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "inbox";
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${slug}-${rnd}@${domain}`;
}
