"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { recordManualWhatsApp, sendReply, type ReplyResult } from "./actions";

function waHref(phone: string, text: string): string | null {
  const d = phone.replace(/[^\d]/g, "");
  const n = d.length === 10 && d.startsWith("0") ? `255${d.slice(1)}` : d.length === 9 ? `255${d}` : d;
  return n.length >= 11 && n.length <= 15 ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** Reply box: email through Resend, WhatsApp through the Cloud API, or WhatsApp on this phone (click-to-chat). */
export function ReplyBox({
  conversationId,
  channel,
  to,
  subject,
  emailReady,
  whatsappApiReady,
  closed,
}: {
  conversationId: string;
  channel: "email" | "whatsapp";
  to: string;
  subject: string;
  emailReady: boolean;
  whatsappApiReady: boolean;
  closed: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReplyResult>({});
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"api" | "link">(channel === "whatsapp" && !whatsappApiReady ? "link" : "api");

  const done = (r: ReplyResult) => {
    setResult(r);
    if (r.ok) {
      setText("");
      router.refresh();
    }
  };

  const submit = (form: FormData) => {
    setResult({});
    start(async () => done(await sendReply(form)));
  };

  const openWhatsApp = () => {
    const href = waHref(to, text.trim());
    if (!href || !text.trim()) {
      setResult({ error: text.trim() ? "The phone number is not valid." : "Write a message first." });
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
    start(async () => done(await recordManualWhatsApp(conversationId, text)));
  };

  return (
    <section className="card" id="reply">
      <h2>{tr("Reply")}</h2>
      {closed && <p className="small muted">{tr("This conversation is closed. Replying opens it again only when they answer.")}</p>}
      <form action={submit}>
        <input type="hidden" name="conversation_id" value={conversationId} />
        {channel === "whatsapp" && (
          <div role="radiogroup" aria-label={tr("Send with")} className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center", opacity: whatsappApiReady ? 1 : 0.55 }}>
              <input type="radio" name="mode" checked={mode === "api"} disabled={!whatsappApiReady} onChange={() => setMode("api")} />
              {tr("Send from the app (WhatsApp Business)")}
            </label>
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input type="radio" name="mode" checked={mode === "link"} onChange={() => setMode("link")} />
              {tr("Open WhatsApp on this phone")}
            </label>
          </div>
        )}
        {channel === "email" && (
          <>
            <div className="field">
              <label htmlFor="r-subject">{tr("Subject")}</label>
              <input id="r-subject" name="subject" type="text" maxLength={300} defaultValue={subject} />
            </div>
            <div className="field">
              <label htmlFor="r-cc">{tr("Copy to (optional)")}</label>
              <input id="r-cc" name="cc" type="text" inputMode="email" placeholder="name@company.co.tz, …" maxLength={1000} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="r-text">
            {tr("Message to")} {to}
          </label>
          <textarea id="r-text" name="text" rows={5} maxLength={20000} required value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {channel === "email" && (
          <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <input type="checkbox" name="quote" defaultChecked /> {tr("Include their last message below")}
          </label>
        )}
        {result.error && <p className="notice notice-error small">{tr(result.error)}</p>}
        {result.ok && <p className="notice small">{tr(result.ok)}</p>}
        <div className="actions">
          {channel === "email" ? (
            <button type="submit" className="btn btn-primary" disabled={pending || !emailReady}>
              {pending ? tr("Sending…") : tr("Send email")}
            </button>
          ) : mode === "api" ? (
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? tr("Sending…") : tr("Send WhatsApp")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={pending} onClick={openWhatsApp}>
              {tr("Open WhatsApp")}
            </button>
          )}
        </div>
        {channel === "email" && !emailReady && (
          <p className="small muted">{tr("Email sending is not set up yet. See Inbox → Setup.")}</p>
        )}
        {channel === "whatsapp" && mode === "link" && (
          <p className="small muted">
            {tr("WhatsApp opens with your text filled in. Press send there; the message is noted here as sent by hand.")}
          </p>
        )}
      </form>
    </section>
  );
}
