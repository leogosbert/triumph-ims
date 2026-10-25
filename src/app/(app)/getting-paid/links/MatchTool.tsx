"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { suggestMatches, type MatchRow } from "../actions";

const WHY: Record<string, string> = { number: "invoice number in the text", amount: "only invoice with this amount", client: "client name in the text" };

/** Paste mobile-money SMS or statement lines: see which are recorded and which invoice the others pay. */
export function MatchTool() {
  const t = useTr();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <div className="field">
        <label htmlFor="match_text">{t("Paste SMS messages or statement lines")}</label>
        <textarea id="match_text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="QJK3H5TY67 Confirmed. You have received Tsh250,000.00 from 255754123456 - JOHN DOE …" />
      </div>
      <button
        className="btn"
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await suggestMatches(text);
            if (r.ok) setRows(r.rows);
            else {
              setRows(null);
              setError(r.error);
            }
          })
        }
      >
        {pending ? t("Reading…") : t("Match references")}
      </button>
      {error ? (
        <p className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {t(error)}
        </p>
      ) : null}
      {rows ? (
        <ul className="list" style={{ marginTop: 12 }}>
          {rows.map((r) => (
            <li key={r.i}>
              <div className="small muted" style={{ overflowWrap: "anywhere" }}>
                {r.text.slice(0, 160)}
              </div>
              <div>
                {r.ref ? <code>{r.ref}</code> : null} {r.amount ? `· TZS ${Number(r.amount).toLocaleString("en-GB")}` : ""}{" "}
                {r.recorded ? (
                  <span className="badge tone-ok">
                    {t("Already recorded")}: {r.recorded.number} ({r.recorded.invoice_number})
                  </span>
                ) : r.invoice ? (
                  <>
                    <span className="badge tone-info">
                      {t("Probably")} {r.invoice.number} · {r.invoice.client}
                    </span>{" "}
                    <span className="small muted">({t(WHY[r.why ?? ""] ?? "")})</span>{" "}
                    <Link className="btn btn-small" href={`/invoices/${r.invoice.id}#payments`}>
                      {t("Record payment")}
                    </Link>
                  </>
                ) : (
                  <span className="badge tone-off">{t("No match found")}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="small muted">{t("Nothing is recorded here: open the invoice to record a payment, with the reference.")}</p>
    </div>
  );
}
