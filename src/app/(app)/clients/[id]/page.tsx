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
import { addContact, removeContact, saveClient, setClientActive } from "../actions";

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
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();

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

  return (
    <>
      <p className="small">
        <Link href="/clients">← Clients</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{client.name}</h1>
        <span className="badge">{client.code}</span>
      </div>
      <p className="muted small">
        Added {formatDate(client.created_at)}
        {!client.active && (
          <>
            {" "}
            · <span className="badge off">Archived</span>
          </>
        )}
      </p>
      <Notice {...notice} />

      <section className="card" id="contacts">
        <h2>Contacts</h2>
        {contacts.length === 0 ? (
          <p className="muted small">No contacts yet.</p>
        ) : (
          <ul className="list">
            {contacts.map((ct) => (
              <li key={ct.id} className="row">
                <div>
                  <strong>{ct.name ?? "(no name)"}</strong> <span className="badge">{kindLabel(ct.kind)}</span>
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
                    <SubmitButton className="btn btn-small btn-danger" pendingText="Removing…">
                      Remove
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <details style={{ marginTop: 12 }}>
            <summary className="small">
              <strong>+ Add a contact</strong>
            </summary>
            <form action={addContact} style={{ marginTop: 12 }}>
              <input type="hidden" name="client_id" value={client.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="c-kind">Type</label>
                  <select id="c-kind" name="kind" defaultValue="purchasing">
                    {CONTACT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-name">Name</label>
                  <input id="c-name" name="name" type="text" />
                </div>
                <div className="field">
                  <label htmlFor="c-position">Position</label>
                  <input id="c-position" name="position" type="text" />
                </div>
                <div className="field">
                  <label htmlFor="c-phone">Phone / WhatsApp</label>
                  <input id="c-phone" name="phone" type="tel" />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="c-email">Email</label>
                  <input id="c-email" name="email" type="email" />
                </div>
              </div>
              <SubmitButton pendingText="Adding…">Add contact</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <form action={saveClient}>
        <input type="hidden" name="id" value={client.id} />
        <fieldset className="plain" disabled={!editable}>
          <RecordFields
            sections={CLIENT_SECTIONS}
            values={client}
            readOnly={!editable}
            lockedKeys={can(role, "setCreditLimit") ? [] : ["credit_limit"]}
          />
          {editable && <SubmitButton className="btn btn-primary btn-block">Save changes</SubmitButton>}
        </fieldset>
      </form>

      {editable && (
        <form action={setClientActive} style={{ marginTop: 16 }}>
          <input type="hidden" name="id" value={client.id} />
          <input type="hidden" name="active" value={client.active ? "false" : "true"} />
          <SubmitButton className={`btn btn-block ${client.active ? "btn-danger" : ""}`} pendingText="Working…">
            {client.active ? "Archive client" : "Restore client"}
          </SubmitButton>
          {client.active && (
            <p className="muted small" style={{ marginTop: 6 }}>
              Archived clients are hidden from lists but keep their history.
            </p>
          )}
        </form>
      )}
    </>
  );
}
