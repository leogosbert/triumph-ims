import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { canUseInbox, type Conversation } from "@/lib/inbox/common";
import { inboxChannels } from "@/lib/inbox/server";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";

export const metadata = { title: "Inbox" };

type Row = Conversation & { client: { name: string } | null; supplier: { name: string } | null };

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!canUseInbox(role)) redirect("/");
  const view = sp.view === "closed" ? "closed" : "open";
  const channel = sp.channel === "email" || sp.channel === "whatsapp" || sp.channel === "portal" ? sp.channel : "";
  const unread = sp.unread === "1";
  const mine = sp.mine === "1";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  let query = supabase
    .from("inbox_conversations")
    .select("*, client:clients(name), supplier:suppliers(name)")
    .eq("company_id", company.id)
    .eq("status", view)
    .order("last_message_at", { ascending: false })
    .limit(300);
  if (channel) query = query.eq("channel", channel);
  if (unread) query = query.gt("unread_count", 0);
  if (mine) query = query.eq("assigned_to", user.id);
  const [{ data, error }, { data: settings }] = await Promise.all([
    query,
    supabase.from("inbox_settings").select("inbound_address, whatsapp_phone_number_id").eq("company_id", company.id).maybeSingle(),
  ]);
  if (isMissingTable(error)) return <NotReady title="Inbox" />;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as unknown as Row[];
  if (q) {
    rows = rows.filter((r) =>
      `${r.subject ?? ""} ${r.counterpart_name ?? ""} ${r.counterpart_address} ${r.preview ?? ""} ${r.client?.name ?? ""} ${r.supplier?.name ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }
  const names = await namesFor(supabase, rows.map((r) => r.assigned_to));
  const ch = inboxChannels();
  const emailOn = Boolean(settings?.inbound_address) && ch.emailReceive;
  const waOn = Boolean(settings?.whatsapp_phone_number_id) && ch.whatsappReceive;
  const params = (over: Record<string, string>) => {
    const p = new URLSearchParams({ view, ...(channel ? { channel } : {}), ...(unread ? { unread: "1" } : {}), ...(mine ? { mine: "1" } : {}), ...(q ? { q } : {}), ...over });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/inbox?${p.toString()}`;
  };

  return (
    <>
      <div className="page-head">
        <h1>{tr("Inbox")}</h1>
        <Link href="/inbox/new" className="btn btn-primary btn-small">
          {tr("+ New message")}
        </Link>
      </div>
      <Notice {...notice} />
      <p className="small" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span className={`badge ${emailOn ? "tone-ok" : "tone-off"}`}>
          {tr("Email")}: {emailOn ? tr("connected") : tr("not connected")}
        </span>
        <span className={`badge ${waOn ? "tone-ok" : "tone-off"}`}>
          {tr("WhatsApp")}: {waOn ? tr("connected") : ch.whatsappSend ? tr("sending only") : tr("links only")}
        </span>
        <Link href="/inbox/setup">{tr("Setup")}</Link>
      </p>

      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href={params({ view: "open" })} aria-current={view === "open" ? "page" : undefined}>
          {tr("Open")}
        </Link>
        <Link href={params({ view: "closed" })} aria-current={view === "closed" ? "page" : undefined}>
          {tr("Closed")}
        </Link>
      </nav>
      <form method="get" className="inline-form" style={{ margin: "8px 0", flexWrap: "wrap" }}>
        <input type="hidden" name="view" value={view} />
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search name, email, phone, subject…")} aria-label={tr("Search")} />
        <select name="channel" defaultValue={channel} aria-label={tr("Channel")}>
          <option value="">{tr("All channels")}</option>
          <option value="email">{tr("Email")}</option>
          <option value="whatsapp">{tr("WhatsApp")}</option>
          <option value="portal">{tr("Portal")}</option>
        </select>
        <label className="small" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" name="unread" value="1" defaultChecked={unread} /> {tr("Unread")}
        </label>
        <label className="small" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> {tr("Mine")}
        </label>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="card muted">
          {view === "closed"
            ? tr("No closed conversations.")
            : emailOn || waOn
              ? tr("Nothing here. New emails and WhatsApp messages from clients and suppliers appear here, and management and sales are told at once.")
              : tr("The inbox is not connected yet. Open Setup to see the few steps needed to receive emails and WhatsApp messages here.")}
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const who = r.client?.name ?? r.supplier?.name ?? r.counterpart_name ?? r.counterpart_address;
            return (
              <li key={r.id}>
                <Link href={`/inbox/${r.id}`}>
                  <div className="main" style={{ minWidth: 0 }}>
                    <div className="title" style={{ fontWeight: r.unread_count > 0 ? 700 : undefined, overflowWrap: "anywhere" }}>
                      {r.channel === "whatsapp" ? "💬 " : r.channel === "portal" ? "🌐 " : "✉️ "}
                      {who}
                      {r.unread_count > 0 && (
                        <span className="badge tone-warn" style={{ marginLeft: 6 }}>
                          {r.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="sub" style={{ overflowWrap: "anywhere" }}>
                      {r.subject && <strong>{r.subject} · </strong>}
                      {r.last_direction === "out" ? `${tr("You")}: ` : ""}
                      {(r.preview ?? "").slice(0, 120)}
                    </div>
                  </div>
                  <div className="side">
                    <div className="small muted">{formatDateTime(r.last_message_at)}</div>
                    {r.assigned_to && <div className="small muted">{names.get(r.assigned_to) ?? ""}</div>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
