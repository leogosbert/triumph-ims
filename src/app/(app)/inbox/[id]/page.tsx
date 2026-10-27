import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { INBOX_ROLES, canUseInbox, type Conversation, type InboxMessage } from "@/lib/inbox/common";
import { replySubject } from "@/lib/inbox/sanitize";
import { inboxChannels, inboxOpensInline } from "@/lib/inbox/server";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { companyPeople, namesFor } from "@/lib/people";
import { can, hasRole } from "@/lib/roles";
import { assignConversation, linkConversation, markUnread, setConversationStatus } from "../actions";
import { HtmlFrame } from "../HtmlFrame";
import { ReplyBox } from "../ReplyBox";
import { noticeFromInbox } from "../../tenders/alerts/actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Conversation" };

type Attachment = { id: string; message_id: string; file_name: string; content_type: string | null; size_bytes: number | null; storage_path: string | null };

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const STATUS_LABEL: Record<InboxMessage["status"], string> = {
  received: "Received",
  sent: "Sent",
  manual: "Sent from WhatsApp on the phone",
  failed: "Not sent",
};

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, features } = await getAppContext();
  if (!canUseInbox(roles)) redirect("/");

  const { data: conv, error } = await supabase
    .from("inbox_conversations")
    .select("*, client:clients(id, name), supplier:suppliers(id, name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Inbox" />;
  if (!conv) notFound();
  const c = conv as Conversation & { client: { id: string; name: string } | null; supplier: { id: string; name: string } | null };

  const [{ data: msgs }, { data: atts }, { data: settings }, people, clients, { data: suppliers }] = await Promise.all([
    supabase.from("inbox_messages").select("*").eq("conversation_id", c.id).order("created_at").limit(500),
    supabase.from("inbox_attachments").select("id, message_id, file_name, content_type, size_bytes, storage_path").eq("conversation_id", c.id),
    supabase.from("inbox_settings").select("whatsapp_phone_number_id").eq("company_id", company.id).maybeSingle(),
    companyPeople(supabase, company.id),
    clientOptions(supabase, company.id),
    supabase.from("suppliers").select("id, name").eq("company_id", company.id).eq("active", true).order("name").limit(2000),
  ]);
  const messages = (msgs ?? []) as InboxMessage[];
  const attachments = (atts ?? []) as Attachment[];
  // Opening the conversation marks it read.
  if (c.unread_count > 0) await supabase.rpc("inbox_mark_read", { p_conversation: c.id, p_read: true });

  // Files from strangers: pictures and PDFs open in the browser, everything else downloads (never opens as a page).
  const stored = attachments.filter((a) => a.storage_path);
  const inline = stored.filter((a) => inboxOpensInline(a.content_type)).map((a) => a.storage_path!);
  const download = stored.filter((a) => !inboxOpensInline(a.content_type)).map((a) => a.storage_path!);
  const [signedInline, signedDownload] = await Promise.all([
    inline.length ? supabase.storage.from("inbox").createSignedUrls(inline, 3600) : null,
    download.length ? supabase.storage.from("inbox").createSignedUrls(download, 3600, { download: true }) : null,
  ]);
  const signed = [...(signedInline?.data ?? []), ...(signedDownload?.data ?? [])];
  const urlOf = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path!, s.signedUrl]));
  const names = await namesFor(supabase, messages.map((m) => m.sent_by));
  const ch = inboxChannels();
  const showHtml = typeof sp.html === "string" ? sp.html : "";
  const who = c.client?.name ?? c.supplier?.name ?? c.counterpart_name ?? c.counterpart_address;
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  const inboxPeople = people.filter((p) => hasRole(p.roles, ...INBOX_ROLES));

  return (
    <>
      <BackLink href="/inbox" label="Inbox" />
      <h1 style={{ overflowWrap: "anywhere" }}>
        {c.channel === "whatsapp" ? "💬 " : c.channel === "portal" ? "🌐 " : "✉️ "}
        {who}
      </h1>
      <p className="muted small" style={{ overflowWrap: "anywhere" }}>
        {c.counterpart_name && c.counterpart_name !== who ? `${c.counterpart_name} · ` : ""}
        {c.channel === "whatsapp" ? `+${c.counterpart_address}` : c.counterpart_address}
        {c.subject && ` · ${c.subject}`}
        {" · "}
        <span className={`badge ${c.status === "open" ? "tone-info" : "tone-off"}`}>{c.status === "open" ? tr("Open") : tr("Closed")}</span>
      </p>
      <p className="small" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {c.client && <Link href={`/clients/${c.client.id}`}>{tr("Client")}: {c.client.name}</Link>}
        {c.supplier && <Link href={`/suppliers/${c.supplier.id}`}>{tr("Supplier")}: {c.supplier.name}</Link>}
        {c.client && can(roles, "editSales") && <Link href={`/rfqs/new?client=${c.client.id}`}>{tr("+ RFQ from this request")}</Link>}
        {c.channel === "email" && (
          <Link href={`/inbox/new?channel=whatsapp&link=${c.client ? `client:${c.client.id}` : c.supplier ? `supplier:${c.supplier.id}` : ""}&name=${encodeURIComponent(who)}`}>
            {tr("Message on WhatsApp instead")}
          </Link>
        )}
      </p>
      {c.channel === "email" && lastIn && can(roles, "seeCrm") && features.ready && features.list.some((f) => f.key === "tender_alerts" && f.enabled) && (
        <form action={noticeFromInbox} className="small" style={{ margin: "0 0 8px" }}>
          <input type="hidden" name="message_id" value={lastIn.id} />
          <input type="hidden" name="back" value={`/inbox/${c.id}`} />
          <button type="submit" className="btn btn-small">
            {tr("Read as a tender notice")}
          </button>
        </form>
      )}
      <Notice {...notice} />

      <section aria-label={tr("Messages")} style={{ display: "grid", gap: 10, margin: "12px 0" }}>
        {messages.length === 0 && <p className="card muted small">{tr("No messages yet. Write the first one below.")}</p>}
        {messages.map((m) => {
          const files = attachments.filter((a) => a.message_id === m.id);
          const mine = m.direction === "out";
          return (
            <article
              key={m.id}
              className="card"
              style={{
                marginLeft: mine ? "min(12%, 48px)" : 0,
                marginRight: mine ? 0 : "min(12%, 48px)",
                borderLeft: mine ? undefined : "3px solid var(--brand, #1c4c9b)",
                opacity: m.status === "failed" ? 0.75 : 1,
              }}
            >
              <div className="small muted" style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "space-between" }}>
                <span style={{ overflowWrap: "anywhere" }}>
                  {mine ? (names.get(m.sent_by ?? "") ?? tr("You")) : (m.from_name ?? m.from_address)}
                  {m.cc_addresses.length > 0 && ` · ${tr("Copy")}: ${m.cc_addresses.join(", ")}`}
                </span>
                <span>
                  {formatDateTime(m.created_at)}
                  {mine && ` · ${tr(STATUS_LABEL[m.status])}`}
                </span>
              </div>
              {m.subject && c.channel === "email" && <div style={{ fontWeight: 600, marginTop: 4, overflowWrap: "anywhere" }}>{m.subject}</div>}
              {m.status === "failed" && m.error && <p className="notice notice-error small">{m.error}</p>}
              {showHtml === m.id && m.body_html ? (
                <div style={{ marginTop: 6 }}>
                  <HtmlFrame html={m.body_html} title={m.subject ?? tr("Email")} />
                  <p className="small">
                    <Link href={`/inbox/${c.id}`}>{tr("Show as plain text")}</Link>
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 6 }}>{m.body_text || "—"}</div>
                  {m.body_html && m.direction === "in" && (
                    <p className="small">
                      <Link href={`/inbox/${c.id}?html=${m.id}#${m.id}`} id={m.id}>
                        {tr("Show formatted email")}
                      </Link>
                    </p>
                  )}
                </>
              )}
              {files.length > 0 && (
                <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {files.map((f) => {
                    const url = f.storage_path ? urlOf.get(f.storage_path) : null;
                    return (
                      <li key={f.id} style={{ overflowWrap: "anywhere" }}>
                        📎{" "}
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {f.file_name}
                          </a>
                        ) : (
                          <span className="muted">
                            {f.file_name} ({tr("not saved: too large or still arriving")})
                          </span>
                        )}{" "}
                        <span className="muted">{size(f.size_bytes)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          );
        })}
      </section>
      {attachments.some((a) => a.storage_path) && (
        <p className="small muted">{tr("File links work for one hour. Reload the page for new ones.")}</p>
      )}

      <ReplyBox
        conversationId={c.id}
        channel={c.channel}
        to={c.channel === "whatsapp" ? `+${c.counterpart_address}` : c.counterpart_address}
        subject={messages.length ? replySubject(lastIn?.subject ?? c.subject) : (c.subject ?? "")}
        emailReady={ch.emailSend}
        whatsappApiReady={ch.whatsappSend && Boolean(settings?.whatsapp_phone_number_id)}
        closed={c.status === "closed"}
      />

      <details className="card">
        <summary>{tr("Who handles it, and link")}</summary>
        <form action={assignConversation} className="inline-form" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={c.id} />
          <select name="user_id" defaultValue={c.assigned_to ?? ""} aria-label={tr("Handled by")}>
            <option value="">{tr("Nobody yet")}</option>
            {inboxPeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
        </form>
        <form action={linkConversation} className="inline-form" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={c.id} />
          <select
            name="link"
            defaultValue={c.client ? `client:${c.client.id}` : c.supplier ? `supplier:${c.supplier.id}` : ""}
            aria-label={tr("Linked to")}
            style={{ maxWidth: "100%" }}
          >
            <option value="">{tr("Not linked")}</option>
            <optgroup label={tr("Clients")}>
              {clients.map((o) => (
                <option key={o.id} value={`client:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            {(suppliers ?? []).length > 0 && (
              <optgroup label={tr("Suppliers")}>
                {((suppliers ?? []) as { id: string; name: string }[]).map((o) => (
                  <option key={o.id} value={`supplier:${o.id}`}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <SubmitButton className="btn btn-small">{tr("Link")}</SubmitButton>
        </form>
        <p className="small muted">
          {tr("Tip: add this email or phone number to the client's contacts, and their next messages are linked by themselves.")}
        </p>
      </details>

      <div className="actions">
        <form action={setConversationStatus}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="status" value={c.status === "open" ? "closed" : "open"} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {c.status === "open" ? tr("Close conversation") : tr("Open again")}
          </SubmitButton>
        </form>
        <form action={markUnread}>
          <input type="hidden" name="id" value={c.id} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Mark as unread")}
          </SubmitButton>
        </form>
      </div>
    </>
  );
}
