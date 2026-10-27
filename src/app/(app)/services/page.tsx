import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import {
  BILLING_MISSING,
  CATEGORIES,
  loadPriceBook,
  planFor,
  priceText,
  REQUEST_STATUS,
  type PriceItem,
  type RequestStatus,
} from "@/lib/billing";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can, hasRole } from "@/lib/roles";
import { cancelRequest, requestService } from "./actions";

export const metadata = { title: "Services & prices" };

type Req = {
  id: string;
  item_key: string;
  quantity: number;
  note: string | null;
  status: RequestStatus;
  requested_at: string;
  admin_note: string | null;
  quoted_price: number | null;
  decided_at: string | null;
  requested_by: string | null;
};

/** Units where asking for more than one makes sense. */
const COUNTABLE = new Set(["user_month", "hour", "day", "bundle", "visit"]);

function RequestForm({ item, back }: { item: PriceItem; back: string }) {
  return (
    <details>
      <summary className="btn btn-small btn-primary">{item.category === "playbook" ? tr("Request this playbook") : tr("Request")}</summary>
      <form action={requestService}>
        <input type="hidden" name="item" value={item.key} />
        <input type="hidden" name="back" value={back} />
        {COUNTABLE.has(item.unit) && (
          <div>
            <label htmlFor={`q-${item.key}`}>{tr("How many")}</label>
            <input id={`q-${item.key}`} name="quantity" type="number" min="1" max="10000" step="1" defaultValue="1" inputMode="numeric" />
          </div>
        )}
        <div>
          <label htmlFor={`n-${item.key}`}>{tr("Note for LeMo Tech (optional)")}</label>
          <textarea
            id={`n-${item.key}`}
            name="note"
            maxLength={1000}
            placeholder={item.category === "playbook" ? tr("Who will use it and why") : tr("When, where, how many people, anything we should know")}
          />
        </div>
        <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Sending…")}>
          {tr("Send request")}
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * Everything LeMo Tech offers, with prices, and the company's requests. Playbooks: anyone may ask.
 * Paid services: management and finance (they are purchases). LeMo Tech approves in LeMoSp ADMIN.
 */
export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const { supabase, company, roles, user } = await getAppContext();
  const canBuy = can(roles, "seeFinance");
  const isManager = hasRole(roles, "management");

  const [book, reqs, billing] = await Promise.all([
    loadPriceBook(supabase),
    supabase
      .from("service_requests")
      .select("id, item_key, quantity, note, status, requested_at, admin_note, quoted_price, decided_at, requested_by")
      .eq("company_id", company.id)
      .neq("status", "cancelled")
      .order("requested_at", { ascending: false })
      .limit(100),
    canBuy ? supabase.from("company_billing").select("currency").eq("company_id", company.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  if (!book.ready) {
    return (
      <>
        <h1>{tr("Services & prices")}</h1>
        <p className="card muted">{tr(BILLING_MISSING)}</p>
      </>
    );
  }

  const own = ((billing.data as { currency?: string } | null)?.currency as "TZS" | "USD" | undefined) ?? "TZS";
  const currency: "TZS" | "USD" = sp.cur === "USD" ? "USD" : sp.cur === "TZS" ? "TZS" : own;
  const requests = (reqs.data ?? []) as Req[];
  const byKey = new Map(book.items.map((i) => [i.key, i]));
  const open = new Map(requests.filter((r) => r.status === "requested").map((r) => [r.item_key, r]));
  const has = new Set(requests.filter((r) => r.status === "approved" || r.status === "delivered").map((r) => r.item_key));
  const myPlan = planFor(book.items, company.business_level);
  const back = `/services${sp.cur ? `?cur=${currency}` : ""}`;
  const t = (s: string) => tr(s);

  return (
    <>
      <div className="page-head">
        <h1>{tr("Services & prices")}</h1>
        <span className="sv-cur" role="group" aria-label={tr("Currency")}>
          {(["TZS", "USD"] as const).map((c) => (
            <Link key={c} href={`/services?cur=${c}`} aria-current={currency === c ? "true" : undefined}>
              {c}
            </Link>
          ))}
        </span>
      </div>
      <p className="muted small">
        {tr("Everything LeMo Tech offers your company, with prices excluding VAT. Choose what you need and press Request: the LeMo Tech team confirms in the app and adds it to your next invoice.")}
      </p>
      <Notice {...notice} />

      {requests.length > 0 && (
        <section className="card" id="requests">
          <h2>{tr("Your requests")}</h2>
          <ul className="list">
            {requests.map((r) => {
              const item = byKey.get(r.item_key);
              const st = REQUEST_STATUS[r.status];
              return (
                <li key={r.id}>
                  <div className="line-head">
                    <div className="sv-req" style={{ minWidth: 0 }}>
                      <span>
                        <strong>{item ? tr(item.name) : r.item_key}</strong>
                        {Number(r.quantity) !== 1 && <> × {Number(r.quantity)}</>} <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
                      </span>
                      <span className="muted">
                        {tr("Asked")} {formatDate(r.requested_at)}
                        {r.decided_at && (
                          <>
                            {" "}
                            · {tr("answered")} {formatDate(r.decided_at)}
                          </>
                        )}
                        {r.quoted_price !== null && (
                          <>
                            {" "}
                            · {tr("agreed price")} {formatMoney(r.quoted_price, currency)}
                          </>
                        )}
                      </span>
                      {r.note && <span className="muted">“{r.note}”</span>}
                      {r.admin_note && (
                        <span className="small">
                          <strong>{tr("LeMo Tech:")}</strong> {r.admin_note}
                        </span>
                      )}
                    </div>
                    <span className="row" style={{ gap: 6 }}>
                      {item?.playbook_id && (r.status === "approved" || r.status === "delivered") && (
                        <Link className="btn btn-small" href={`/playbooks/${item.playbook_id}`}>
                          {tr("Open")}
                        </Link>
                      )}
                      {r.status === "requested" && (r.requested_by === user.id || isManager) && (
                        <form action={cancelRequest}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="back" value={back} />
                          <SubmitButton className="btn btn-small" pendingText="…">
                            {tr("Cancel")}
                          </SubmitButton>
                        </form>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="sv-jump" aria-label={tr("Sections")}>
        {CATEGORIES.filter((c) => book.items.some((i) => i.category === c.key)).map((c) => (
          <a key={c.key} href={`#${c.key}`}>
            {tr(c.title)}
          </a>
        ))}
      </nav>

      {!canBuy && (
        <p className="hint">{tr("You can request playbooks yourself. Paid services are requested by management or finance: tell them what you need.")}</p>
      )}

      {CATEGORIES.map((c) => {
        const items = book.items.filter((i) => i.category === c.key);
        if (items.length === 0) return null;
        return (
          <section key={c.key} id={c.key} className="sv-section">
            <h2>{tr(c.title)}</h2>
            <p className="muted small">{tr(c.lead)}</p>
            <div className="sv-grid">
              {items.map((i) => {
                const current = i.category === "plan" && myPlan?.key === i.key;
                const waiting = open.get(i.key);
                const owned = has.has(i.key);
                const mayAsk = i.requestable && (i.category === "playbook" || canBuy);
                return (
                  <article key={i.key} className={`sv-card${current ? " is-current" : ""}`}>
                    <h3>{tr(i.name)}</h3>
                    <span className="sv-price">{priceText(i, currency, t)}</span>
                    {i.description && <p>{tr(i.description)}</p>}
                    <div className="sv-foot">
                      {current && <span className="badge tone-info">{tr("Your plan")}</span>}
                      {i.category === "plan" && !current && isManager && (
                        <Link className="btn btn-small" href="/settings/features">
                          {tr("Change level")}
                        </Link>
                      )}
                      {owned && i.playbook_id && (
                        <Link className="btn btn-small" href={`/playbooks/${i.playbook_id}`}>
                          {tr("Open playbook")}
                        </Link>
                      )}
                      {owned && !i.playbook_id && <span className="badge tone-ok">{tr("You have this")}</span>}
                      {waiting && <span className="badge tone-warn">{tr("Requested")}</span>}
                    </div>
                    {mayAsk && !waiting && !(owned && (i.playbook_id || i.unit === "month")) && <RequestForm item={i} back={back} />}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {canBuy && (
        <p className="small">
          <Link href="/settings/billing">{tr("See your plan, invoices and how to pay")} ›</Link>
        </p>
      )}
    </>
  );
}
