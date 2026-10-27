"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { formatDateTime, optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { canUseInbox, replyToAddress, type Conversation, type InboxMessage, type InboxSettings } from "@/lib/inbox/common";
import { addressList, messageIds, quoteForReply, replySubject } from "@/lib/inbox/sanitize";
import { inboxChannels, pollMailbox, sendEmailReply } from "@/lib/inbox/server";
import { sendWhatsAppText } from "@/lib/inbox/whatsapp";
import { portalLoginUrl, sendPortalEmail } from "@/lib/portal/server";

async function ctx() {
  const c = await getAppContext();
  if (!canUseInbox(c.roles)) redirect(withNotice("/", { error: "Your role does not include the inbox." }));
  return c;
}

function refresh(id?: string) {
  revalidatePath("/inbox");
  if (id) revalidatePath(`/inbox/${id}`);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type ReplyResult = { ok?: string; error?: string };

/** Sends a reply by email (Resend) or WhatsApp (Cloud API) and records it in the conversation. */
export async function sendReply(form: FormData): Promise<ReplyResult> {
  const { supabase, company } = await ctx();
  const id = str(form, "conversation_id");
  const text = str(form, "text").trim();
  if (!text) return { error: "Write a message first." };
  if (text.length > 20000) return { error: "The message is too long." };
  const [{ data: conv }, { data: settings }] = await Promise.all([
    supabase.from("inbox_conversations").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase.from("inbox_settings").select("*").eq("company_id", company.id).maybeSingle(),
  ]);
  const c = conv as Conversation | null;
  const s = settings as InboxSettings | null;
  if (!c) return { error: "Conversation not found." };
  const channels = inboxChannels();

  // Client or supplier portal: the reply shows on their Messages page; an email tells them it is there.
  if (c.channel === "portal") {
    const { error } = await supabase.rpc("inbox_record_outbound", {
      p_conversation: c.id,
      p_msg: { status: "sent", text, provider: "portal", to: [c.counterpart_address], from: s?.reply_name || company.name },
    });
    refresh(c.id);
    if (error) return { error: friendlyError(error.message) };
    await sendPortalEmail({
      to: c.counterpart_address,
      fromName: (s?.reply_name || company.name).slice(0, 80),
      subject: `New message from ${company.name}`,
      lines: [`${company.name} answered your message on the portal:`, text.length > 600 ? `${text.slice(0, 600)}…` : text, "Sign in to the portal to reply."],
      button: { label: "Open the portal", url: portalLoginUrl(company.id, c.counterpart_address) },
    });
    return { ok: "Reply sent to their portal." };
  }

  if (c.channel === "email") {
    if (!channels.emailSend) return { error: "Email sending is not set up yet. See Inbox → Setup." };
    const { data: lastIn } = await supabase
      .from("inbox_messages")
      .select("email_message_id, reference_ids, body_text, from_name, from_address, created_at, subject")
      .eq("conversation_id", c.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = lastIn as Pick<InboxMessage, "email_message_id" | "reference_ids" | "body_text" | "from_name" | "from_address" | "created_at" | "subject"> | null;
    const cc = addressList(str(form, "cc"));
    const subject = (str(form, "subject") || replySubject(last?.subject || c.subject)).slice(0, 300);
    const signature = s?.signature ? `\n\n${s.signature}` : "";
    const quoted = form.get("quote") === "on" && last ? quoteForReply(last.body_text, formatDateTime(last.created_at), last.from_name ?? last.from_address ?? "", 4000) : "";
    const fullText = `${text}${signature}${quoted}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(text + signature).replace(/\n/g, "<br>")}${
      quoted ? `<br><br><div style="color:#5b6675;border-left:3px solid #d0d7e2;padding-left:10px">${esc(quoted.trim()).replace(/\n/g, "<br>")}</div>` : ""
    }</div>`;
    const inReplyTo = last?.email_message_id ?? null;
    const references = [...(last?.reference_ids ?? []), ...(inReplyTo ? [inReplyTo] : [])].filter((v, i, a) => a.indexOf(v) === i);
    const sent = await sendEmailReply({
      to: [c.counterpart_address],
      cc,
      subject,
      text: fullText,
      html,
      replyTo: replyToAddress(s?.inbound_address, c.ref),
      fromName: s?.reply_name || company.name,
      inReplyTo,
      references: messageIds(references),
    }, s?.inbound_address ?? null);
    const { error } = await supabase.rpc("inbox_record_outbound", {
      p_conversation: c.id,
      p_msg: {
        status: sent.ok ? "sent" : "failed",
        text: fullText,
        html,
        subject,
        to: [c.counterpart_address],
        cc,
        provider: sent.ok && sent.via === "mailbox" ? "smtp" : "resend",
        provider_message_id: sent.ok ? sent.id : null,
        message_id: sent.ok ? sent.messageId : null,
        from: sent.ok ? sent.from : null,
        in_reply_to: inReplyTo,
        references,
        error: sent.ok ? null : sent.error,
      },
    });
    refresh(c.id);
    if (!sent.ok) return { error: `The email was not sent: ${sent.error}` };
    if (error) return { error: `Sent, but not saved in the conversation: ${friendlyError(error.message)}` };
    return { ok: "Email sent." };
  }

  // WhatsApp through the Cloud API.
  if (!channels.whatsappSend || !s?.whatsapp_phone_number_id) {
    return { error: "WhatsApp sending is not connected. Use Open WhatsApp instead." };
  }
  const sent = await sendWhatsAppText(s.whatsapp_phone_number_id, c.counterpart_address, text);
  const { error } = await supabase.rpc("inbox_record_outbound", {
    p_conversation: c.id,
    p_msg: {
      status: sent.ok ? "sent" : "failed",
      text,
      provider: "whatsapp",
      provider_message_id: sent.ok ? sent.id : null,
      to: [c.counterpart_address],
      error: sent.ok ? null : sent.error,
    },
  });
  refresh(c.id);
  if (!sent.ok) return { error: `The WhatsApp message was not sent: ${sent.error}` };
  if (error) return { error: `Sent, but not saved in the conversation: ${friendlyError(error.message)}` };
  return { ok: "WhatsApp message sent." };
}

/** Opened WhatsApp on the phone with the text filled in: note it in the conversation as sent by hand. */
export async function recordManualWhatsApp(conversationId: string, text: string): Promise<ReplyResult> {
  const { supabase } = await ctx();
  const body = text.trim();
  if (!body) return { error: "Write a message first." };
  const { error } = await supabase.rpc("inbox_record_outbound", {
    p_conversation: conversationId,
    p_msg: { status: "manual", text: body, provider: "wa_link" },
  });
  refresh(conversationId);
  return error ? { error: friendlyError(error.message) } : { ok: "Noted as sent from WhatsApp." };
}

/** Opened the phone's mail app with the reply filled in (no sending set up): note it as sent by hand. */
export async function recordManualEmail(conversationId: string, text: string, subject: string): Promise<ReplyResult> {
  const { supabase } = await ctx();
  const body = text.trim();
  if (!body) return { error: "Write a message first." };
  const { error } = await supabase.rpc("inbox_record_outbound", {
    p_conversation: conversationId,
    p_msg: { status: "manual", text: body, subject: subject.slice(0, 300), provider: "mail_app" },
  });
  refresh(conversationId);
  return error ? { error: friendlyError(error.message) } : { ok: "Noted as sent from your mail app." };
}

/** Setup page: read the company mailbox now instead of waiting for the next 5-minute check. */
export async function checkMailboxNow() {
  const { isManager } = await ctx();
  if (!isManager) redirect(withNotice("/inbox/setup", { error: "Only management can change the inbox settings." }));
  const r = await pollMailbox(8_000);
  revalidatePath("/inbox");
  revalidatePath("/inbox/setup");
  redirect(
    withNotice(
      "/inbox/setup",
      r.status === "ok"
        ? { msg: r.recorded ? `${r.recorded} new email(s) brought into the Inbox.` : "Checked: no new emails." }
        : { error: r.error ?? r.status },
    ),
  );
}

export async function setConversationStatus(form: FormData) {
  const id = str(form, "id");
  const status = str(form, "status") === "closed" ? "closed" : "open";
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("inbox_set_status", { p_conversation: id, p_status: status });
  refresh(id);
  if (error) redirect(withNotice(`/inbox/${id}`, { error: friendlyError(error.message) }));
  redirect(status === "closed" ? withNotice("/inbox", { msg: "Conversation closed." }) : withNotice(`/inbox/${id}`, { msg: "Opened again." }));
}

export async function assignConversation(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("inbox_assign", { p_conversation: id, p_user: optional(form, "user_id") });
  refresh(id);
  redirect(withNotice(`/inbox/${id}`, error ? { error: friendlyError(error.message) } : { msg: "Saved." }));
}

export async function markUnread(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("inbox_mark_read", { p_conversation: id, p_read: false });
  refresh(id);
  redirect(error ? withNotice(`/inbox/${id}`, { error: friendlyError(error.message) }) : "/inbox");
}

export async function linkConversation(form: FormData) {
  const id = str(form, "id");
  const [kind, target] = str(form, "link").split(":");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("inbox_link", {
    p_conversation: id,
    p_client: kind === "client" ? target || null : null,
    p_supplier: kind === "supplier" ? target || null : null,
  });
  refresh(id);
  redirect(withNotice(`/inbox/${id}`, error ? { error: friendlyError(error.message) } : { msg: "Saved." }));
}

export async function startConversation(form: FormData) {
  const { supabase, company } = await ctx();
  const channel = str(form, "channel") === "whatsapp" ? "whatsapp" : "email";
  const [kind, target] = str(form, "link").split(":");
  const { data, error } = await supabase.rpc("inbox_start_conversation", {
    p_company: company.id,
    p_channel: channel,
    p_address: str(form, "address"),
    p_name: optional(form, "name"),
    p_subject: optional(form, "subject"),
    p_client: kind === "client" ? target || null : null,
    p_supplier: kind === "supplier" ? target || null : null,
  });
  if (error || !data) redirect(withNotice(`/inbox/new?channel=${channel}`, { error: friendlyError(error?.message) }));
  refresh(String(data));
  redirect(`/inbox/${data}`);
}

export async function saveInboxSettings(form: FormData) {
  const { supabase, company, isManager } = await ctx();
  if (!isManager) redirect(withNotice("/inbox/setup", { error: "Only management can change the inbox settings." }));
  const { error } = await supabase.rpc("inbox_save_settings", {
    p_company: company.id,
    p_settings: {
      inbound_address: str(form, "inbound_address"),
      whatsapp_phone_number_id: str(form, "whatsapp_phone_number_id"),
      whatsapp_display_phone: str(form, "whatsapp_display_phone"),
      reply_name: str(form, "reply_name"),
      signature: str(form, "signature"),
    },
  });
  revalidatePath("/inbox/setup");
  redirect(withNotice("/inbox/setup", error ? { error: friendlyError(error.message) } : { msg: "Saved." }));
}
