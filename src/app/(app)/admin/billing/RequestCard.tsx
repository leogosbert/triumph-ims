import { tr } from "@/lib/tr";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { REQUEST_STATUS, UNIT_LABEL, type RequestStatus, type Unit } from "@/lib/billing";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { decideRequest } from "./actions";

export type AdminRequest = {
  id: string;
  company_id: string;
  company_name: string;
  business_level: string;
  item_key: string;
  item_name: string;
  category: string;
  playbook_id: string | null;
  quantity: number;
  note: string | null;
  status: RequestStatus;
  requested_by_name: string | null;
  requested_by_role: string | null;
  requested_at: string;
  admin_note: string | null;
  quoted_price: number | null;
  decided_at: string | null;
  invoice_id: string | null;
  price_tzs: number | null;
  price_usd: number | null;
  unit: Unit;
};

/** One request with what LeMo Tech can do next. Used here and on each company's billing page. */
export function RequestCard({ r, back, showCompany = true }: { r: AdminRequest; back: string; showCompany?: boolean }) {
  const st = REQUEST_STATUS[r.status];
  const onRequest = r.price_tzs === null;
  return (
    <li>
      <div className="adm-req">
        <div className="line-head">
          <div style={{ minWidth: 0 }}>
            <strong>{r.item_name}</strong>
            {Number(r.quantity) !== 1 && <> × {Number(r.quantity)}</>} <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
            {r.invoice_id && <span className="badge tone-info">{tr("Billed")}</span>}
            <div className="muted small">
              {showCompany && (
                <>
                  <Link href={`/admin/billing/${r.company_id}`}>{r.company_name}</Link> <LevelBadge level={r.business_level} /> ·{" "}
                </>
              )}
              {r.requested_by_name ? `${r.requested_by_name}${r.requested_by_role ? ` (${tr(r.requested_by_role)})` : ""}` : tr("Added by LeMo Tech")} ·{" "}
              {formatDateTime(r.requested_at)}
            </div>
            <div className="small">
              {onRequest
                ? tr("Price on request")
                : `${formatMoney(r.price_tzs, "TZS")} / ${formatMoney(r.price_usd, "USD")} ${tr(UNIT_LABEL[r.unit])}`}
              {r.quoted_price !== null && ` · ${tr("agreed price")} ${formatMoney(r.quoted_price, "TZS")}`}
            </div>
            {r.note && <div className="small">“{r.note}”</div>}
            {r.admin_note && (
              <div className="small muted">
                {tr("Your note:")} {r.admin_note}
              </div>
            )}
          </div>
        </div>
        {r.status !== "declined" && r.status !== "cancelled" && r.status !== "ended" && (
          <form action={decideRequest} className="adm-req-actions">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="back" value={back} />
            <input name="note" maxLength={1000} placeholder={tr("Note to the company (optional)")} aria-label={tr("Note to the company")} />
            {onRequest && r.status === "requested" && (
              <input name="quoted_price" inputMode="decimal" placeholder={tr("Agreed price (TZS)")} aria-label={tr("Agreed price")} style={{ maxWidth: 160 }} />
            )}
            {r.status === "requested" && (
              <>
                <SubmitButton className="btn btn-small btn-primary" name="action" value="approve" pendingText="…">
                  {r.playbook_id ? tr("Give playbook") : tr("Approve")}
                </SubmitButton>
                <SubmitButton className="btn btn-small" name="action" value="decline" pendingText="…">
                  {tr("Decline")}
                </SubmitButton>
              </>
            )}
            {(r.status === "requested" || r.status === "approved") && !r.playbook_id && (
              <SubmitButton className="btn btn-small" name="action" value="deliver" pendingText="…">
                {tr("Mark done")}
              </SubmitButton>
            )}
            {(r.status === "approved" || r.status === "delivered") && (r.playbook_id || r.category === "addon" || r.unit === "month") && (
              <SubmitButton className="btn btn-small btn-danger" name="action" value="end" pendingText="…">
                {r.playbook_id ? tr("Take back") : tr("End")}
              </SubmitButton>
            )}
          </form>
        )}
      </div>
    </li>
  );
}

