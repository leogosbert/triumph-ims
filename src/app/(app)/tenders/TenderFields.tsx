import { tr } from "@/lib/tr";
import { darParts } from "@/lib/crm";
import { CURRENCIES } from "@/lib/lists";

export type TenderValues = {
  title?: string;
  client_id?: string | null;
  buyer_name?: string | null;
  reference?: string | null;
  category?: string | null;
  published_on?: string | null;
  site_visit_at?: string | null;
  clarification_by?: string | null;
  closing_at?: string | null;
  submission?: string | null;
  bid_security?: number | null;
  estimated_value?: number | null;
  our_price?: number | null;
  currency?: string;
  owner_id?: string | null;
  opportunity_id?: string | null;
  notes?: string | null;
};

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function TenderFields({
  v,
  clients,
  people,
  opportunities,
  base,
}: {
  v: TenderValues;
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  opportunities: { id: string; number: string; title: string }[];
  base: string;
}) {
  const closing = darParts(v.closing_at);
  const visit = darParts(v.site_visit_at);
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="title">{tr("Tender for")}</label>
        <input id="title" name="title" type="text" required minLength={2} maxLength={300} defaultValue={v.title ?? ""} placeholder={tr("e.g. Supply of lubricants and greases for 2027")} />
      </div>
      <div className="field">
        <label htmlFor="client_id">{tr("Buyer (client)")}</label>
        <select id="client_id" name="client_id" defaultValue={v.client_id ?? ""}>
          <option value="">{tr("— Not a client yet —")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="buyer_name">
          {tr("Buyer name")} <span className="hint">· {tr("if not a client")}</span>
        </label>
        <input id="buyer_name" name="buyer_name" type="text" maxLength={200} defaultValue={v.buyer_name ?? ""} placeholder={tr("e.g. Tanzania Ports Authority")} />
      </div>
      <div className="field">
        <label htmlFor="reference">{tr("Tender number")}</label>
        <input id="reference" name="reference" type="text" maxLength={120} defaultValue={v.reference ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="category">{tr("Category")}</label>
        <input id="category" name="category" type="text" maxLength={120} defaultValue={v.category ?? ""} placeholder={tr("Goods, works, services")} />
      </div>
      <div className="field">
        <label htmlFor="closing_date">{tr("Closing date")}</label>
        <input id="closing_date" name="closing_date" type="date" required defaultValue={closing.date} />
      </div>
      <div className="field">
        <label htmlFor="closing_time">{tr("Closing time")}</label>
        <input id="closing_time" name="closing_time" type="time" defaultValue={closing.time || "10:00"} />
      </div>
      <div className="field">
        <label htmlFor="published_on">{tr("Published on")}</label>
        <input id="published_on" name="published_on" type="date" defaultValue={v.published_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="clarification_by">{tr("Questions to the buyer by")}</label>
        <input id="clarification_by" name="clarification_by" type="date" defaultValue={v.clarification_by ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="site_visit_date">{tr("Site visit / pre-bid meeting")}</label>
        <input id="site_visit_date" name="site_visit_date" type="date" defaultValue={visit.date} />
      </div>
      <div className="field">
        <label htmlFor="site_visit_time">{tr("Time")}</label>
        <input id="site_visit_time" name="site_visit_time" type="time" defaultValue={visit.time} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="submission">{tr("How to submit")}</label>
        <input id="submission" name="submission" type="text" maxLength={300} defaultValue={v.submission ?? ""} placeholder={tr("e.g. NeST online system, or sealed envelope to the tender box")} />
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <select id="currency" name="currency" defaultValue={v.currency ?? base}>
          {[...new Set([base, ...CURRENCIES])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="bid_security">{tr("Bid security")}</label>
        <input id="bid_security" name="bid_security" type="text" inputMode="decimal" defaultValue={num(v.bid_security)} />
      </div>
      <div className="field">
        <label htmlFor="estimated_value">{tr("Estimated value")}</label>
        <input id="estimated_value" name="estimated_value" type="text" inputMode="decimal" defaultValue={num(v.estimated_value)} />
      </div>
      <div className="field">
        <label htmlFor="our_price">{tr("Our bid price")}</label>
        <input id="our_price" name="our_price" type="text" inputMode="decimal" defaultValue={num(v.our_price)} />
      </div>
      <div className="field">
        <label htmlFor="owner_id">{tr("Responsible")}</label>
        <select id="owner_id" name="owner_id" defaultValue={v.owner_id ?? ""}>
          <option value="">{tr("Me")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="opportunity_id">{tr("Opportunity")}</label>
        <select id="opportunity_id" name="opportunity_id" defaultValue={v.opportunity_id ?? ""}>
          <option value="">{tr("— None —")}</option>
          {opportunities.map((o) => (
            <option key={o.id} value={o.id}>
              {o.number} · {o.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
