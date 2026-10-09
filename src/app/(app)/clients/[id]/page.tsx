import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { CLIENT_SECTIONS } from "@/lib/fields";
import { formatDate } from "@/lib/format";
import { CONTACT_KINDS } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { daysOverdue, INVOICE_STATUS, n, openBase, shownStatus } from "@/lib/finance";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/lib/sales";
import { addContact, removeContact, saveClient, setClientActive } from "../actions";
import { ClientCrm } from "../../crm/ClientCrm";
import { LinkedDocuments } from "@/components/LinkedDocuments";

export const metadata = { title: "Client" };

type Contact = {
  id: string;
  kind: string;
  name: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
};

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features } = await getAppContext();

  const [{ data: client }, { data: contactData }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase
      .from("client_contacts")
      .select("id, kind, name, position, email, phone")
      .eq("client_id", id)
      .eq("company_id", company.id)
      .order("created_at"),
  ]);
  if (!client) notFound();
  const contacts = (contactData ?? []) as Contact[];
  const editable = can(role, "editClients");
  const kindLabel = (k: string) => CONTACT_KINDS.find((c) => c.value === k)?.label ?? k;
  type Inv = { id: string; number: string; status: string; issue_date: string | null; due_date: string | null; total: number; amount_paid: number; exchange_rate: number; currency: string };
  const { data: invData } = can(role, "seeInvoices")
    ? await supabase
        .from("invoices")
        .select("id, number, status, issue_date, due_date, total, amount_paid, exchange_rate, currency")
        .eq("client_id", id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: null };
  const invoices = (invData ?? []) as Inv[];
  const openInv = invoices.filter((i) => i.status === "issued" || i.status === "partly_paid");
  const owed = openInv.reduce((s, i) => s + openBase(i), 0);
  const overdue = openInv.filter((i) => daysOverdue(i.due_date) > 0).reduce((s, i) => s + openBase(i), 0);
  const limit = n(client.credit_limit);
  const base = company.base_currency;

  return (
    <>
      <p className="small">
        <Link href="/clients">{tr("← Clients")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{client.name}</h1>
        <span className="badge">{client.code}</span>
      </div>
      <p className="muted small">{tr("Added")}{" "}{formatDate(client.created_at)}
        {!client.active && (
          <>
            {" "}
            · <span className="badge off">{tr("Archived")}</span>
          </>
        )}
      </p>
      <Notice {...notice} />

      {invData && (
        <section className="card" id="account">
          <h2>{tr("Account")}</h2>
          <dl className="kv">
            <dt>{tr("Owed to us")}</dt>
            <dd>
              <strong>{formatMoney(owed, base)}</strong>
            </dd>
            <dt>{tr("Overdue")}</dt>
            <dd className={overdue > 0 ? "text-warn" : undefined}>{formatMoney(overdue, base)}</dd>
            <dt>{tr("Credit limit")}</dt>
            <dd>{limit > 0 ? formatMoney(limit, base) : tr("Not set")}</dd>
            {limit > 0 && (
              <>
                <dt>{tr("Credit available")}</dt>
                <dd className={limit - owed < 0 ? "text-warn" : undefined}>{formatMoney(limit - owed, base)}</dd>
              </>
            )}
          </dl>
          {features.on("statements") && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              <Link href={`/clients/${client.id}/statement`}>{tr("Statement of account →")}</Link>
            </p>
          )}
          {invoices.length > 0 && (
            <ul className="list" style={{ marginTop: 8 }}>
              {invoices.slice(0, 10).map((i) => (
                <li key={i.id} className="row">
                  <Link href={`/invoices/${i.id}`}>
                    {i.number || tr("Draft")}
                    {i.issue_date ? ` · ${formatDate(i.issue_date)}` : ""}
                  </Link>
                  <span className="small">
                    {formatMoney(i.status === "partly_paid" ? n(i.total) - n(i.amount_paid) : i.total, i.currency)}{" "}
                    <StatusBadge map={INVOICE_STATUS} status={shownStatus(i.status, i.due_date)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" id="contacts">
        <h2>{tr("Contacts")}</h2>
        {contacts.length === 0 ? (
          <p className="muted small">{tr("No contacts yet.")}</p>
        ) : (
          <ul className="list">
            {contacts.map((ct) => (
              <li key={ct.id} className="row">
                <div>
                  <strong>{ct.name ?? tr("(no name)")}</strong> <span className="badge">{kindLabel(ct.kind)}</span>
                  {ct.position && <div className="muted small">{ct.position}</div>}
                  <div className="small">
                    {ct.phone && <a href={`tel:${ct.phone.replace(/\s/g, "")}`}>{ct.phone}</a>}
                    {ct.phone && ct.email && " · "}
                    {ct.email && <a href={`mailto:${ct.email}`}>{ct.email}</a>}
                  </div>
                </div>
                {editable && (
                  <form action={removeContact}>
                    <input type="hidden" name="client_id" value={client.id} />
                    <input type="hidden" name="contact_id" value={ct.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText={tr("Removing…")}>{tr("Remove")}</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <details style={{ marginTop: 12 }}>
            <summary className="small">
              <strong>{tr("+ Add a contact")}</strong>
            </summary>
            <form action={addContact} style={{ marginTop: 12 }}>
              <input type="hidden" name="client_id" value={client.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="c-kind">{tr("Type")}</label>
                  <select id="c-kind" name="kind" defaultValue="purchasing">
                    {CONTACT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {tr(String(k.label ?? ""))}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-name">{tr("Name")}</label>
                  <input id="c-name" name="name" type="text" />
                </div>
                <div className="field">
                  <label htmlFor="c-position">{tr("Position")}</label>
                  <input id="c-position" name="position" type="text" />
                </div>
                <div className="field">
                  <label htmlFor="c-phone">{tr("Phone / WhatsApp")}</label>
                  <input id="c-phone" name="phone" type="tel" />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="c-email">{tr("Email")}</label>
                  <input id="c-email" name="email" type="email" />
                </div>
              </div>
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add contact")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <ClientCrm supabase={supabase} companyId={company.id} clientId={client.id} role={role} features={features} />
      {can(role, "seeDocuments") && features.on("documents") && (
        <LinkedDocuments supabase={supabase} companyId={company.id} field="client_id" id={client.id} back={`/clients/${client.id}#documents`} />
      )}

      <form action={saveClient}>
        <input type="hidden" name="id" value={client.id} />
        <fieldset className="plain" disabled={!editable}>
          <RecordFields
            sections={CLIENT_SECTIONS}
            values={client}
            readOnly={!editable}
            lockedKeys={can(role, "setCreditLimit") ? [] : ["credit_limit"]}
          />
          {editable && <SubmitButton className="btn btn-primary btn-block">{tr("Save changes")}</SubmitButton>}
        </fieldset>
      </form>

      {editable && (
        <form action={setClientActive} style={{ marginTop: 16 }}>
          <input type="hidden" name="id" value={client.id} />
          <input type="hidden" name="active" value={client.active ? "false" : "true"} />
          <SubmitButton className={`btn btn-block ${client.active ? "btn-danger" : ""}`} pendingText={tr("Working…")}>
            {client.active ? tr("Archive client") : tr("Restore client")}
          </SubmitButton>
          {client.active && (
            <p className="muted small" style={{ marginTop: 6 }}>{tr("Archived clients are hidden from lists but keep their history.")}</p>
          )}
        </form>
      )}
    </>
  );
}
