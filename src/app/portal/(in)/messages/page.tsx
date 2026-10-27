import { tr } from "@/lib/tr";
import { formatDateTime } from "@/lib/format";
import { call, requirePortal } from "@/lib/portal/server";
import type { PortalMessage } from "@/lib/portal/types";
import { sendMessage } from "../../actions";
import { ActionForm } from "../../_c/ActionForm";

export const metadata = { title: "Messages" };

/** One conversation with our team. It lands in the app's Inbox; replies from there show here. */
export default async function PortalMessages() {
  const ctx = await requirePortal();
  const msgs = await call<PortalMessage[]>(ctx, "portal_messages");
  const company = ctx.me.company.name;
  return (
    <>
      <div className="page-head">
        <h1>{tr("Messages")}</h1>
      </div>
      <section className="card">
        {msgs.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            {tr("Write to our team here. We answer on this page and by email.")}
          </p>
        ) : (
          <ol className="portal-thread">
            {msgs.map((m) => (
              <li key={m.id} className={m.direction === "in" ? "mine" : "theirs"}>
                <div className="portal-bubble">
                  {m.subject && <strong className="small">{m.subject}</strong>}
                  <p>{m.text}</p>
                </div>
                <span className="small muted">
                  {m.direction === "in" ? tr("You") : company} · {formatDateTime(m.created_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="card">
        <h2>{tr("New message")}</h2>
        <ActionForm action={sendMessage} resetOnOk>
          {msgs.length === 0 && (
            <div className="field">
              <label htmlFor="pm-subject">
                {tr("Subject")} <span className="hint">{tr("optional")}</span>
              </label>
              <input id="pm-subject" name="subject" type="text" maxLength={200} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pm-text">{tr("Message")}</label>
            <textarea id="pm-text" name="text" required maxLength={4000} rows={4} />
          </div>
          <button type="submit" className="btn btn-primary btn-block">{tr("Send")}</button>
        </ActionForm>
      </section>
    </>
  );
}
