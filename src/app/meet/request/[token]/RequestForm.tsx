"use client";

import { useActionState } from "react";
import { useTr } from "@/lib/tr-client";
import { submitRequest, type RequestState } from "./actions";
import styles from "../../../(app)/meetings/meetings.module.css";

export function RequestForm({ token, shownAt }: { token: string; shownAt: number }) {
  const tr = useTr();
  const [state, run, pending] = useActionState<RequestState, FormData>(submitRequest, {});
  if (state.ok) {
    return <p className="notice notice-ok">{tr("Thank you. Your request was sent. We will answer by email.")}</p>;
  }
  return (
    <form action={run}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="t" value={shownAt} />
      <div className={styles.honey} aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="field">
        <span>{tr("Your name")}</span>
        <input name="name" required minLength={2} maxLength={120} autoComplete="name" />
      </label>
      <label className="field">
        <span>{tr("Your company")}</span>
        <input name="company" maxLength={160} autoComplete="organization" />
      </label>
      <label className="field">
        <span>{tr("Email")}</span>
        <input type="email" name="email" required maxLength={200} autoComplete="email" />
      </label>
      <label className="field">
        <span>{tr("Phone (optional)")}</span>
        <input type="tel" name="phone" maxLength={20} autoComplete="tel" />
      </label>
      <label className="field">
        <span>{tr("What is the meeting about?")}</span>
        <input name="topic" required minLength={3} maxLength={200} />
      </label>
      <div className="inline-form">
        <label className="field">
          <span>{tr("Proposed date and time (Tanzania time)")}</span>
          <input type="datetime-local" name="proposed_at" required />
        </label>
        <label className="field">
          <span>{tr("Minutes")}</span>
          <select name="minutes" defaultValue="30">
            {[15, 30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{tr("Your meeting link, if you host it (Zoom, Teams, Google Meet)")}</span>
        <input type="url" name="link" maxLength={500} placeholder="https://" />
      </label>
      <label className="field">
        <span>{tr("Message (optional)")}</span>
        <textarea name="message" rows={3} maxLength={2000} />
      </label>
      {state.error && <p className="notice notice-error">{tr(state.error)}</p>}
      <button className="btn btn-primary btn-block" disabled={pending}>
        {pending ? tr("Sending…") : tr("Send the request")}
      </button>
    </form>
  );
}
