import { addOrderCost, removeOrderCost } from "@/app/(app)/finance/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { COST_KINDS, n } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { CURRENCIES } from "@/lib/lists";
import { formatMoney } from "@/lib/money";
import { todayTz } from "@/lib/sales";

export type OrderCost = {
  id: string;
  kind: string;
  description: string | null;
  amount: number;
  currency: string;
  exchange_rate: number;
  incurred_on: string;
};

/** List of extra costs with an add form. Attach to a quotation (order) or a purchase order. */
export function OrderCosts({
  costs,
  back,
  quotationId,
  poId,
  base,
  canEdit,
  defaultCurrency,
}: {
  costs: OrderCost[];
  back: string;
  quotationId?: string;
  poId?: string;
  base: string;
  canEdit: boolean;
  defaultCurrency?: string;
}) {
  const total = costs.reduce((s, c) => s + n(c.amount) * n(c.exchange_rate), 0);
  return (
    <>
      {costs.length === 0 ? (
        <p className="muted small">No extra costs recorded.</p>
      ) : (
        <ul className="list">
          {costs.map((c) => (
            <li key={c.id} className="row">
              <span>
                <strong>{COST_KINDS[c.kind] ?? c.kind}</strong>
                <span className="small muted">
                  {c.description ? ` · ${c.description}` : ""} · {formatDate(c.incurred_on)}
                </span>
              </span>
              <span className="row" style={{ gap: 8 }}>
                <span>
                  {formatMoney(c.amount, c.currency)}
                  {c.currency !== base && <span className="small muted"> ≈ {formatMoney(n(c.amount) * n(c.exchange_rate), base)}</span>}
                </span>
                {canEdit && (
                  <form action={removeOrderCost}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="back" value={back} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                      ✕
                    </SubmitButton>
                  </form>
                )}
              </span>
            </li>
          ))}
          <li className="row">
            <strong>Total extra costs</strong>
            <strong>{formatMoney(total, base)}</strong>
          </li>
        </ul>
      )}
      {canEdit && (
        <details style={{ marginTop: 12 }}>
          <summary>
            <strong>+ Add a cost</strong>
          </summary>
          <form action={addOrderCost} style={{ marginTop: 12 }}>
            <input type="hidden" name="back" value={back} />
            {quotationId && <input type="hidden" name="quotation_id" value={quotationId} />}
            {poId && <input type="hidden" name="po_id" value={poId} />}
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor={`kind-${back}`}>Type</label>
                <select id={`kind-${back}`} name="kind" defaultValue={poId ? "duty" : "transport"}>
                  {Object.entries(COST_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`desc-${back}`}>Description</label>
                <input id={`desc-${back}`} name="description" type="text" placeholder="e.g. TRA duty, agent invoice no." />
              </div>
              <div className="field">
                <label htmlFor={`amt-${back}`}>Amount</label>
                <input id={`amt-${back}`} name="amount" type="text" inputMode="decimal" required />
              </div>
              <div className="field">
                <label htmlFor={`ccy-${back}`}>Currency</label>
                <select id={`ccy-${back}`} name="currency" defaultValue={defaultCurrency ?? base}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`rate-${back}`}>
                  Exchange rate <span className="hint">· if not {base}</span>
                </label>
                <input id={`rate-${back}`} name="exchange_rate" type="text" inputMode="decimal" defaultValue="1" />
              </div>
              <div className="field">
                <label htmlFor={`date-${back}`}>Date</label>
                <input id={`date-${back}`} name="incurred_on" type="date" defaultValue={todayTz()} />
              </div>
            </div>
            <SubmitButton pendingText="Adding…">Add cost</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
