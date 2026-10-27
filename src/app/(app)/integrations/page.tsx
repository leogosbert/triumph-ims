import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiKeyCreator } from "@/components/assistant/ApiKeyCreator";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, stage13Ready } from "@/lib/context";
import { monthRange } from "@/lib/finance";
import { formatDate, formatDateTime } from "@/lib/format";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can, hasRole } from "@/lib/roles";
import { siteUrl } from "@/lib/supabase/env";
import { createApiKey, revokeApiKey } from "./actions";

export const metadata = { title: "Integrations & API" };

type Key = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; use_count: number; revoked_at: string | null };

const RESOURCES: [string, string][] = [
  ["clients", "Clients with TIN, VRN, terms and credit limit"],
  ["suppliers", "Suppliers with country, currency and lead time"],
  ["products", "Products with SKU, unit, price and reorder level"],
  ["stock", "Stock on hand per product, store and batch"],
  ["quotations", "Quotations with status and totals"],
  ["invoices", "Issued invoices with VAT, totals, paid and balance"],
  ["payments", "Payments received, with method and reference"],
  ["purchase_orders", "Purchase orders to suppliers"],
];

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const { supabase, company, roles, features } = await getAppContext();
  if (!can(roles, "seeFinance")) redirect("/");
  const isManager = hasRole(roles, "management");
  if (!features.on("integrations")) {
    return (
      <>
        <h1>{tr("Integrations & API")}</h1>
        <p className="card muted">
          {tr("Integrations are switched off for this company.")}{" "}
          {isManager ? <Link href="/settings/features">{tr("Switch it on in Features & business level.")}</Link> : tr("Ask management to switch it on.")}
        </p>
      </>
    );
  }

  const m = monthRange(typeof sp.m === "string" ? sp.m : monthRange().prev);
  const { data, error } = isManager
    ? await supabase.from("api_keys").select("id, name, prefix, created_at, last_used_at, use_count, revoked_at").eq("company_id", company.id).order("created_at", { ascending: false })
    : { data: [], error: null };
  const ready = !isMissingTable(error);
  const keys = (data ?? []) as Key[];
  const base = `${siteUrl()}/api/v1`;
  const exports: [string, string, boolean][] = [
    ["invoices", "Invoices (sales and output VAT)", true],
    ["payments", "Payments received", true],
    ["bills", "Supplier bills (purchases and input VAT)", true],
    ["expenses", "Expenses", stage13Ready(company)],
  ];

  return (
    <>
      <h1>{tr("Integrations & API")}</h1>
      <p className="muted small">
        {tr("Enter data once in LeMoSp and share it with your accountant, your accounting software and other systems.")}
      </p>
      <Notice {...notice} />

      <section className="card" id="accounting">
        <h2>{tr("Accounting export")}</h2>
        <p className="small muted">
          {tr("One month at a time, as a CSV file that opens in Excel and imports into accounting software (QuickBooks, Xero, Sage, Tally). Every file has the amounts in the document currency and in")} {company.base_currency}.
        </p>
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="m">{tr("Month")}</label>
            <input id="m" name="m" type="month" defaultValue={m.month} />
          </div>
          <button type="submit" className="btn btn-small">
            {tr("Show")}
          </button>
        </form>
        <ul className="list" style={{ marginTop: 12 }}>
          {exports.map(([kind, label, on]) => (
            <li key={kind} className="row" style={{ gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {tr(label)} · <span className="muted">{tr(m.label)}</span>
              </span>
              {on ? (
                <a className="btn btn-small" href={`/integrations/export?kind=${kind}&m=${m.month}`} download>
                  {tr("Download CSV")}
                </a>
              ) : (
                <span className="muted small">{tr("After the Stage 13 update")}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {tr("Tip: send the four files to your accountant at the start of each month, together with the bank and mobile-money statements.")}
        </p>
      </section>

      {isManager && (
        <section className="card" id="keys">
          <h2>{tr("API keys")}</h2>
          {!ready ? (
            <p className="muted">{tr("This is not available yet. Ask LeMo Tech to run the latest database update.")}</p>
          ) : (
            <>
              <p className="small muted">
                {tr("A key lets another system read your data through the LeMoSp API. Make one key per system, so you can switch one off without stopping the others. Keys can only read, never change anything.")}
              </p>
              <ApiKeyCreator create={createApiKey} />
              {keys.length > 0 && (
                <ul className="list" style={{ marginTop: 14 }}>
                  {keys.map((k) => (
                    <li key={k.id}>
                      <div className="line-head">
                        <div style={{ minWidth: 0 }}>
                          <strong>{k.name}</strong> {k.revoked_at ? <span className="badge tone-off">{tr("Switched off")}</span> : <span className="badge tone-ok">{tr("In use")}</span>}
                          <div className="muted small">
                            <code>{k.prefix}…</code> · {tr("made")} {formatDate(k.created_at)} · {k.last_used_at ? `${tr("last used")} ${formatDateTime(k.last_used_at)}` : tr("never used")} · {k.use_count} {tr("calls")}
                          </div>
                        </div>
                        {!k.revoked_at && (
                          <form action={revokeApiKey}>
                            <input type="hidden" name="id" value={k.id} />
                            <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                              {tr("Switch off")}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <section className="card" id="api">
        <h2>{tr("For developers: the LeMoSp API")}</h2>
        <p className="small">
          {tr("Read only, over HTTPS, answers in JSON. Each call needs the header Authorization: Bearer followed by the key.")}
        </p>
        <pre className="int-code">{`GET ${base}/invoices?since=2026-10-01&limit=100&offset=0
Authorization: Bearer lmsp_…

curl -H "Authorization: Bearer $LEMOSP_KEY" \\
  "${base}/clients?limit=50"`}</pre>
        <div className="int-grid" style={{ marginTop: 12 }}>
          <div>
            <h3>{tr("What can be read")}</h3>
            <ul className="small">
              {RESOURCES.map(([r, d]) => (
                <li key={r}>
                  <code>/api/v1/{r}</code>: {tr(d)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>{tr("Options")}</h3>
            <ul className="small">
              <li>
                <code>since</code>: {tr("only records changed after this date and time, to fetch what is new since the last call")}
              </li>
              <li>
                <code>limit</code>: {tr("records per page, 1 to 500 (100 if left out)")}
              </li>
              <li>
                <code>offset</code>: {tr("where the page starts; the answer gives next_offset while there are more")}
              </li>
            </ul>
            <h3>{tr("Answer")}</h3>
            <pre className="int-code">{`{ "resource": "invoices", "count": 100,
  "next_offset": 100, "data": [ … ] }`}</pre>
            <p className="small muted">{tr("Errors: 401 wrong or switched-off key, 403 integrations switched off, 400 wrong options.")}</p>
          </div>
        </div>
      </section>
    </>
  );
}
