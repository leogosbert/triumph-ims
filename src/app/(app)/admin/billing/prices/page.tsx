import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { BILLING_MISSING, CATEGORIES, UNIT_LABEL, type PriceItem, type Unit } from "@/lib/billing";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { PLAYBOOKS } from "@/lib/playbooks";
import { loadPriceBook } from "@/lib/billing";
import { platformAdmin } from "../../guard";
import { savePriceItem } from "../actions";

export const metadata = { title: "Price book" };

const UNITS = Object.keys(UNIT_LABEL) as Unit[];

function ItemForm({ i }: { i: PriceItem | null }) {
  const n = i?.key ?? "new";
  return (
    <form action={savePriceItem} className="stack">
      <div className="grid">
        <div>
          <label htmlFor={`k-${n}`}>{tr("Key")}</label>
          {i ? (
            <>
              <input type="hidden" name="key" value={i.key} />
              <input id={`k-${n}`} value={i.key} disabled />
            </>
          ) : (
            <input id={`k-${n}`} name="key" required pattern="[a-z][a-z0-9_\-]{1,59}" placeholder="training_mwanza" />
          )}
        </div>
        <div>
          <label htmlFor={`c-${n}`}>{tr("Category")}</label>
          <select id={`c-${n}`} name="category" defaultValue={i?.category ?? "service"}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {tr(c.title)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`u-${n}`}>{tr("Charged")}</label>
          <select id={`u-${n}`} name="unit" defaultValue={i?.unit ?? "once"}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {tr(UNIT_LABEL[u])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`s-${n}`}>{tr("Order")}</label>
          <input id={`s-${n}`} name="sort" inputMode="numeric" defaultValue={String(i?.sort ?? 100)} />
        </div>
      </div>
      <label htmlFor={`n-${n}`}>{tr("Name")}</label>
      <input id={`n-${n}`} name="name" required maxLength={120} defaultValue={i?.name ?? ""} />
      <label htmlFor={`d-${n}`}>{tr("Description")}</label>
      <textarea id={`d-${n}`} name="description" maxLength={600} defaultValue={i?.description ?? ""} />
      <div className="grid">
        <div>
          <label htmlFor={`t-${n}`}>{tr("Price TZS (empty = on request)")}</label>
          <input id={`t-${n}`} name="price_tzs" inputMode="decimal" defaultValue={i?.price_tzs ?? ""} />
        </div>
        <div>
          <label htmlFor={`d2-${n}`}>{tr("Price USD (empty = on request)")}</label>
          <input id={`d2-${n}`} name="price_usd" inputMode="decimal" defaultValue={i?.price_usd ?? ""} />
        </div>
        <div>
          <label htmlFor={`l-${n}`}>{tr("Level (plans, setup)")}</label>
          <select id={`l-${n}`} name="level" defaultValue={i?.level ?? ""}>
            <option value="">—</option>
            <option value="small">{tr("Small")}</option>
            <option value="medium">{tr("Medium")}</option>
            <option value="enterprise">{tr("Enterprise")}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`iu-${n}`}>{tr("Users included (plans)")}</label>
          <input id={`iu-${n}`} name="included_users" inputMode="numeric" defaultValue={i?.included_users ?? ""} />
        </div>
      </div>
      <div className="grid">
        <div>
          <label htmlFor={`f-${n}`}>{tr("Features it switches on (add-ons)")}</label>
          <input id={`f-${n}`} name="feature_keys" defaultValue={(i?.feature_keys ?? []).join(", ")} placeholder="multi_currency, landed_cost" />
        </div>
        <div>
          <label htmlFor={`p-${n}`}>{tr("Playbook it gives")}</label>
          <select id={`p-${n}`} name="playbook_id" defaultValue={i?.playbook_id ?? ""}>
            <option value="">—</option>
            {PLAYBOOKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <label className="check">
          <input type="checkbox" name="requestable" defaultChecked={i?.requestable ?? true} /> {tr("Companies can request it")}
        </label>
        <label className="check">
          <input type="checkbox" name="public" defaultChecked={i?.public ?? false} /> {tr("On the public price page")}
        </label>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={i?.active ?? true} /> {tr("Offered")}
        </label>
      </div>
      <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Saving…")}>
        {i ? tr("Save") : tr("Add to the price book")}
      </SubmitButton>
    </form>
  );
}

/** Everything LeMo Tech sells, with prices in TZS and USD. Changes apply to new requests and invoices. */
export default async function AdminPricesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const book = await loadPriceBook(admin.supabase);
  if (!book.ready) return <p className="card muted">{tr(BILLING_MISSING)}</p>;

  return (
    <>
      <Notice {...notice} />
      <section className="card">
        <h2>{tr("Price book")}</h2>
        <p className="muted small">
          {tr("Prices exclude VAT. New prices apply to new requests and invoices; invoices already made keep their amounts. Switch an item off instead of deleting it, so old invoices still make sense.")}
        </p>
        <details>
          <summary className="btn btn-small btn-primary">{tr("Add an item")}</summary>
          <div style={{ marginTop: 10 }}>
            <ItemForm i={null} />
          </div>
        </details>
      </section>
      {CATEGORIES.map((c) => {
        const list = book.items.filter((i) => i.category === c.key);
        if (list.length === 0) return null;
        return (
          <section key={c.key} className="card">
            <h2>{tr(c.title)}</h2>
            <ul className="list">
              {list.map((i) => (
                <li key={i.key} id={i.key}>
                  <details>
                    <summary className="line-head" style={{ cursor: "pointer" }}>
                      <span style={{ minWidth: 0 }}>
                        <strong>{i.name}</strong> {!i.active && <span className="badge tone-off">{tr("Not offered")}</span>}
                        {i.public && <span className="badge tone-info">{tr("Public")}</span>}
                        <div className="small muted">
                          {i.price_tzs === null ? tr("Price on request") : `${formatMoney(i.price_tzs, "TZS")} · ${formatMoney(i.price_usd, "USD")}`} {tr(UNIT_LABEL[i.unit])}
                        </div>
                      </span>
                    </summary>
                    <div style={{ marginTop: 10 }}>
                      <ItemForm i={i} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
