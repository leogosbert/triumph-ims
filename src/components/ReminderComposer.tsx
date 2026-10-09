"use client";

import { useState } from "react";
import { waNumber, type Recipient } from "@/lib/reminders";
import { useTr } from "@/lib/tr-client";

/**
 * A ready-made message the person checks, edits and sends from their own phone: WhatsApp, SMS
 * or email, or copy it to paste anywhere. Nothing is sent by the app itself.
 */
export function ReminderComposer({
  en,
  sw,
  subject,
  recipients,
  startLang = "en",
}: {
  en: string;
  sw: string;
  subject: string;
  recipients: Recipient[];
  startLang?: "en" | "sw";
}) {
  const tr = useTr();
  const [lang, setLang] = useState<"en" | "sw">(startLang);
  const [text, setText] = useState(startLang === "sw" ? sw : en);
  const [who, setWho] = useState(0);
  const [copied, setCopied] = useState(false);
  const r = recipients[who] ?? null;
  const wa = waNumber(r?.phone);
  const tel = r?.phone?.replace(/[^\d+]/g, "") ?? "";
  const body = encodeURIComponent(text);

  function switchLang(l: "en" | "sw") {
    setLang(l);
    setText(l === "sw" ? sw : en);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the person can still select the text */
    }
  }

  return (
    <div className="composer">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        {recipients.length > 0 && (
          <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
            <label htmlFor="composer_to">{tr("Send to")}</label>
            <select id="composer_to" value={who} onChange={(e) => setWho(Number(e.target.value))}>
              {recipients.map((x, i) => (
                <option key={i} value={i}>
                  {x.label}
                  {x.phone ? ` · ${x.phone}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="tabs-row" style={{ margin: 0 }} role="group" aria-label={tr("Language")}>
          <button type="button" className="btn btn-small" aria-pressed={lang === "en"} onClick={() => switchLang("en")}>
            English
          </button>
          <button type="button" className="btn btn-small" aria-pressed={lang === "sw"} onClick={() => switchLang("sw")}>
            Kiswahili
          </button>
        </div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="composer_text" className="sr-only">
          {tr("Message")}
        </label>
        <textarea id="composer_text" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        {wa && (
          <a className="btn btn-primary btn-small" href={`https://wa.me/${wa}?text=${body}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
        {tel && (
          <a className="btn btn-small" href={`sms:${tel}?body=${body}`}>
            SMS
          </a>
        )}
        {r?.email && (
          <a className="btn btn-small" href={`mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${body}`}>
            {tr("Email")}
          </a>
        )}
        {!wa && (
          <a className="btn btn-small" href={`https://wa.me/?text=${body}`} target="_blank" rel="noreferrer">
            {tr("WhatsApp (choose contact)")}
          </a>
        )}
        <button type="button" className="btn btn-small" onClick={copy}>
          {copied ? tr("Copied") : tr("Copy")}
        </button>
      </div>
      {recipients.length === 0 && <p className="small muted">{tr("No phone or email saved for this client. Add a contact on the client's page, or copy the message.")}</p>}
    </div>
  );
}
