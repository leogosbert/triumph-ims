"use client";

import { useActionState, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { feedLink, type FeedState } from "./actions";
import styles from "../meetings/meetings.module.css";

const KINDS: [string, string][] = [
  ["meeting", "Meetings"],
  ["action", "My actions"],
  ["entry", "Calendar dates"],
  ["delivery", "Deliveries"],
  ["supplies", "Supplies arriving"],
  ["quotation", "Quotations and RFQs"],
  ["invoice", "Invoices due"],
  ["compliance", "Filings and licences"],
  ["leave", "Leave"],
  ["follow_up", "Follow-ups"],
];

/** "Phone calendar": a private link for Google Calendar, iPhone or Outlook (one way: the app stays the source). */
export function FeedLink({ hasLink, kinds }: { hasLink: boolean; kinds: string[] }) {
  const tr = useTr();
  const [state, run, pending] = useActionState<FeedState, FormData>(feedLink, {});
  const [copied, setCopied] = useState(false);
  return (
    <form action={run}>
      <fieldset className="field">
        <legend>{tr("What goes in it")}</legend>
        <div className={styles.chips}>
          {KINDS.map(([k, l]) => (
            <label key={k} className={styles.chip}>
              <input type="checkbox" name="kinds" value={k} defaultChecked={kinds.length === 0 || kinds.includes(k)} /> {tr(l)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="inline-form" style={{ gap: 6 }}>
        <button className="btn btn-primary btn-small" name="how" value="get" disabled={pending}>
          {hasLink ? tr("Show my link") : tr("Make my link")}
        </button>
        {hasLink && (
          <>
            <button className="btn btn-small" name="how" value="new" disabled={pending}>
              {tr("New link (old one stops)")}
            </button>
            <button className="btn btn-small" name="how" value="off" disabled={pending}>
              {tr("Switch off")}
            </button>
          </>
        )}
      </div>
      {state.error && <p className="small" style={{ color: "var(--bad, #c0392b)" }}>{tr(state.error)}</p>}
      {state.off && <p className="small muted">{tr("Your calendar link is switched off.")}</p>}
      {state.url && (
        <div style={{ marginTop: 10 }}>
          <p className="small">{tr("Keep this link private: anyone with it sees your dates.")}</p>
          <div className={styles.feedBox}>{state.url}</div>
          <div className="inline-form" style={{ gap: 6, marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-small"
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
            <a className="btn btn-small" href={state.webcal}>
              {tr("iPhone / Mac")}
            </a>
            <a className="btn btn-small" href={state.google} target="_blank" rel="noopener noreferrer">
              {tr("Google Calendar")}
            </a>
            <a className="btn btn-small" href={state.outlook} target="_blank" rel="noopener noreferrer">
              {tr("Outlook")}
            </a>
          </div>
          <p className="small muted">{tr("Phones refresh subscribed calendars every few hours, so a new date can take a while to show.")}</p>
        </div>
      )}
    </form>
  );
}
