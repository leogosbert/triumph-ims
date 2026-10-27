import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { portalLoginUrl } from "@/lib/portal/server";
import { hasRole, type Role } from "@/lib/roles";

export const metadata = { title: "Portals" };

type Person = { id: string; name: string; email: string; party: string; status: string; last_sign_in_at: string | null; client_id: string | null; supplier_id: string | null; client: { name: string } | null; supplier: { name: string } | null };
type Sub = { id: string; kind: string; supplier_invoice_no: string | null; reference: string | null; total: number; currency: string; created_at: string; supplier: { name: string } | null; po: { number: string } | null };
type Bank = { id: string; bank_name: string; requested_at: string; supplier: { name: string } | null };
type Log = { id: string; action: string; details: Record<string, unknown> | null; created_at: string };

const ROLES: Role[] = ["management", "sales", "procurement", "finance", "warehouse"];

const ACTION: Record<string, string> = {
  portal_sign_in: "signed in",
  portal_download: "downloaded",
  portal_quotation_accepted: "accepted a quotation",
  portal_quotation_declined: "declined a quotation",
  portal_message: "sent a message",
  portal_rfq_quoted: "sent prices",
  portal_rfq_declined: "cannot quote",
  portal_po_confirmed: "confirmed a purchase order",
  portal_submitted_invoice: "sent an invoice",
  portal_submitted_delivery_note: "sent a delivery note",
  portal_supplier_details: "updated their details",
  portal_bank_change_requested: "asked to change bank details",
  portal_file_uploaded: "sent a file",
  portal_rfq_sent: "RFQ sent via portal",
};

/** Our side of the client and supplier portals: who has access, what is waiting to be checked, and activity. */
export default async function PortalAdmin({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, features } = await getAppContext();
  if (!hasRole(roles, ...ROLES)) redirect("/");
  const isManager = hasRole(roles, "management");

  const [{ data: peopleData, error }, { data: subData }, { data: bankData }, { data: logData }] = await Promise.all([
    supabase
      .from("portal_users")
      .select("id, name, email, party, status, last_sign_in_at, client_id, supplier_id, client:clients(name), supplier:suppliers(name)")
      .eq("company_id", company.id)
      .eq("status", "active")
      .order("last_sign_in_at", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("portal_submissions")
      .select("id, kind, supplier_invoice_no, reference, total, currency, created_at, supplier:suppliers(name), po:purchase_orders(number)")
      .eq("company_id", company.id)
      .eq("status", "submitted")
      .order("created_at")
      .limit(100),
    supabase
      .from("supplier_bank_details")
      .select("id, bank_name, requested_at, supplier:suppliers(name)")
      .eq("company_id", company.id)
      .eq("status", "pending")
      .order("requested_at"),
    isManager
      ? supabase.from("audit_log").select("id, action, details, created_at").eq("company_id", company.id).like("action", "portal\\_%").order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
  ]);
  if (error) {
    return (
      <>
        <h1>{tr("Portals")}</h1>
        <p className="notice notice-error">{tr("The portal database update has not been run yet (20261027000201_portal.sql).")}</p>
      </>
    );
  }
  const people = (peopleData ?? []) as unknown as Person[];
  const subs = (subData ?? []) as unknown as Sub[];
  const banks = (bankData ?? []) as unknown as Bank[];
  const logs = (logData ?? []) as Log[];
  const clientOn = features.on("client_portal");
  const supplierOn = features.on("supplier_portal");

  return (
    <>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{tr("Portals")}</h1>
      </div>
      <p className="muted small">
        {tr("Clients and suppliers sign in at")}{" "}
        <a href={portalLoginUrl(company.id)} target="_blank" rel="noopener">
          {portalLoginUrl(company.id).replace(/^https?:\/\//, "").split("?")[0]}
        </a>{" "}
        {tr("with a one-time code. Invite them from the client or supplier page.")}
      </p>
      <Notice {...notice} />
      {isManager && (!clientOn || !supplierOn) && (
        <p className="small">
          {!clientOn && tr("The client portal is off.")} {!supplierOn && tr("The supplier portal is off.")}{" "}
          <Link href="/settings/features">{tr("Features →")}</Link>
        </p>
      )}

      <div className="stat-grid">
        <a href="#people" className="stat">
          <span className="n">{people.length}</span>
          <span className="l">{tr("People with access")}</span>
        </a>
        <a href="#check" className={`stat${subs.length ? " alert" : ""}`}>
          <span className="n">{subs.length}</span>
          <span className="l">{tr("Documents to check")}</span>
        </a>
        {(isManager || hasRole(roles, "finance")) && (
          <a href="#bank" className={`stat${banks.length ? " alert" : ""}`}>
            <span className="n">{banks.length}</span>
            <span className="l">{tr("Bank changes to approve")}</span>
          </a>
        )}
      </div>

      {(isManager || hasRole(roles, "finance")) && banks.length > 0 && (
        <section className="card" id="bank">
          <h2>{tr("Bank changes to approve")}</h2>
          <ul className="list">
            {banks.map((b) => (
              <li key={b.id} className="row">
                <Link href={`/portal-admin/bank/${b.id}`}>
                  <strong>{b.supplier?.name}</strong> · {b.bank_name}
                </Link>
                <span className="small muted">{formatDateTime(b.requested_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" id="check">
        <h2>{tr("Documents to check")}</h2>
        {subs.length === 0 ? (
          <p className="muted small">{tr("Nothing waiting. Invoices and delivery notes from the supplier portal show here.")}</p>
        ) : (
          <ul className="list">
            {subs.map((s) => (
              <li key={s.id} className="row">
                <Link href={`/portal-admin/submissions/${s.id}`}>
                  <strong>{s.supplier?.name}</strong> · {s.kind === "invoice" ? `${tr("Invoice")} ${s.supplier_invoice_no ?? ""}` : `${tr("Delivery note")} ${s.reference ?? ""}`}
                  {s.po ? ` · ${s.po.number}` : ""}
                </Link>
                <span className="small muted">
                  {s.kind === "invoice" ? `${formatMoney(s.total, s.currency)} · ` : ""}
                  {formatDate(s.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" id="people">
        <h2>{tr("People with access")}</h2>
        {people.length === 0 ? (
          <p className="muted small">{tr("Nobody yet. Open a client or supplier and use Invite to portal.")}</p>
        ) : (
          <ul className="list">
            {people.map((p) => (
              <li key={p.id} className="row">
                <span style={{ minWidth: 0 }}>
                  <Link href={p.party === "client" ? `/clients/${p.client_id}#portal` : `/suppliers/${p.supplier_id}#portal`}>
                    <strong>{p.name}</strong> · {p.client?.name ?? p.supplier?.name}
                  </Link>
                  <br />
                  <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                    {p.party === "client" ? tr("Client") : tr("Supplier")} · {p.email}
                  </span>
                </span>
                <span className="small muted">{p.last_sign_in_at ? formatDateTime(p.last_sign_in_at) : tr("Not signed in yet")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isManager && logs.length > 0 && (
        <section className="card">
          <h2>{tr("Recent portal activity")}</h2>
          <ul className="list">
            {logs.map((l) => {
              const d = l.details ?? {};
              const who = String(d.portal_name ?? "") || tr("Our team");
              const what = String(d.number ?? d.name ?? d.invoice_no ?? d.file_name ?? "");
              return (
                <li key={l.id} className="row small">
                  <span>
                    <strong>{who}</strong> {tr(ACTION[l.action] ?? l.action.replace(/^portal_/, "").replace(/_/g, " "))}
                    {what ? ` · ${what}` : ""}
                  </span>
                  <span className="muted">{formatDateTime(l.created_at)}</span>
                </li>
              );
            })}
          </ul>
          <p className="small" style={{ margin: "8px 0 0" }}>
            <Link href="/activity">{tr("Full activity log →")}</Link>
          </p>
        </section>
      )}
    </>
  );
}
