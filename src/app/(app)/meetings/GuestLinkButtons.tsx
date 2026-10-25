"use client";

import { useActionState, useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { guestLink, type GuestLinkState } from "./actions";
import styles from "./meetings.module.css";

/** Make a guest's link and send it: copy, email (from the app) or WhatsApp (opens WhatsApp with the text). */
export function GuestLinkButtons({ attendeeId, hasEmail, hasPhone }: { attendeeId: string; hasEmail: boolean; hasPhone: boolean }) {
  const tr = useTr();
  const [state, run, pending] = useActionState<GuestLinkState, FormData>(guestLink, {});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.wa) window.open(state.wa, "_blank", "noopener,noreferrer");
  }, [state.wa]);

  return (
    <div>
      <form action={run} className="inline-form" style={{ gap: 6 }}>
        <input type="hidden" name="attendee_id" value={attendeeId} />
        <button className="btn btn-small" name="how" value="copy" disabled={pending}>
          {tr("Get link")}
        </button>
        {hasEmail && (
          <button className="btn btn-small" name="how" value="email" disabled={pending}>
            {tr("Email link")}
          </button>
        )}
        {hasPhone && (
          <button className="btn btn-small" name="how" value="whatsapp" disabled={pending}>
            {tr("WhatsApp link")}
          </button>
        )}
      </form>
      {state.error && <p className="small" style={{ color: "var(--bad, #c0392b)" }}>{tr(state.error)}</p>}
      {state.msg && <p className="small muted">{tr(state.msg)}</p>}
      {state.wa && (
        <p className="small">
          <a href={state.wa} target="_blank" rel="noopener noreferrer">
            {tr("Open WhatsApp again")}
          </a>
        </p>
      )}
      {state.url && (
        <div style={{ marginTop: 6 }}>
          <div className={styles.feedBox}>{state.url}</div>
          <button
            type="button"
            className="btn btn-small"
            style={{ marginTop: 6 }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.url!);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? tr("Copied") : tr("Copy")}
          </button>
        </div>
      )}
    </div>
  );
}
