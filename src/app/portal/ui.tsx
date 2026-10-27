import { tr } from "@/lib/tr";
import type { Progress, RfqRow } from "@/lib/portal/types";

/** Status words on the portal, in the client's or supplier's terms. */
export const QUOTE_STATUS: Record<string, { label: string; tone: string }> = {
  sent: { label: "Waiting for your answer", tone: "info" },
  accepted: { label: "Accepted", tone: "ok" },
  rejected: { label: "Declined", tone: "off" },
};
export const INVOICE_STATUS: Record<string, { label: string; tone: string }> = {
  issued: { label: "Unpaid", tone: "info" },
  partly_paid: { label: "Part paid", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  overdue: { label: "Overdue", tone: "bad" },
};
export const DELIVERY_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Being prepared", tone: "off" },
  dispatched: { label: "On the way", tone: "info" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Not delivered", tone: "bad" },
};
export const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "ok" },
  rejected: { label: "Cancelled", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
  superseded: { label: "Replaced", tone: "off" },
};
export const RFQ_STATUS: Record<string, { label: string; tone: string }> = {
  invited: { label: "To answer", tone: "warn" },
  quoted: { label: "Answered", tone: "ok" },
  declined: { label: "Declined", tone: "off" },
  closed: { label: "Closed", tone: "off" },
  won: { label: "You won", tone: "ok" },
};
/** A supplier's view of a request: to answer, answered, closed, or won. */
export const rfqState = (r: Pick<RfqRow, "rfq_status" | "status" | "awarded_to_you">) =>
  r.awarded_to_you ? "won" : r.rfq_status !== "open" ? "closed" : r.status;
export const PO_STATUS: Record<string, { label: string; tone: string }> = {
  sent: { label: "To confirm", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "ok" },
  partially_received: { label: "Partly received", tone: "info" },
  received: { label: "Received", tone: "ok" },
  closed: { label: "Closed", tone: "off" },
};
export const SUBMISSION_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: "Being checked", tone: "info" },
  billed: { label: "Accepted", tone: "ok" },
  accepted: { label: "Checked", tone: "ok" },
  rejected: { label: "Sent back", tone: "bad" },
};
export const DOC_KINDS: Record<string, string> = {
  certificate: "Certificate",
  licence: "Licence",
  sds: "Safety data sheet",
  coa: "Certificate of analysis",
  datasheet: "Datasheet",
  contract: "Contract",
  tender: "Tender",
  insurance: "Insurance",
  tax: "Tax",
  company: "Company document",
  other: "Document",
};

export function Badge({ map, status }: { map: Record<string, { label: string; tone: string }>; status: string }) {
  const s = map[status] ?? { label: status, tone: "off" };
  return <span className={`badge tone-${s.tone}`}>{tr(s.label)}</span>;
}

/** Our order stages in the client's words (the app says "Won" and "Sent to client"). */
const STAGE_WORDS: Record<string, string> = {
  quoted: "Prepared",
  approved: "Checked",
  sent: "Sent to you",
  won: "You accepted",
  delivered: "Delivered",
  invoiced: "Invoiced",
  paid: "Paid",
};
export const stageWord = (st: { key: string; label: string }) => STAGE_WORDS[st.key] ?? st.label;

/** The order's stages as a bar and a list (no names of our team). */
export function ProgressBar({ progress }: { progress: Progress }) {
  if (!progress) return null;
  return (
    <div className="portal-progress">
      <div className="portal-progress-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(4, progress.percent)}%` }} />
      </div>
      <ol className="portal-stages">
        {progress.stages.map((st) => (
          <li key={st.key} className={st.done ? "done" : progress.next?.key === st.key ? "next" : undefined}>
            {tr(stageWord(st))}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="muted small portal-empty">{tr(text)}</p>;
}
