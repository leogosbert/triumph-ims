import { tr } from "@/lib/tr";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Features } from "@/lib/features";
import { hasRole, type Role, type RoleSet } from "@/lib/roles";
import type { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { inviteToPortal, revokePortal, shareDocument } from "@/app/(app)/portal-admin/actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type PortalUser = { id: string; name: string; email: string; position: string | null; status: string; invited_at: string; last_sign_in_at: string | null };
type Doc = { id: string; title: string; kind: string; file_path: string | null };
type PFile = { id: string; purpose: string; title: string | null; file_name: string; expires_on: string | null; created_at: string };
type Bank = { id: string; status: string; bank_name: string; account_number: string; currency: string; requested_at: string; decided_at: string | null };

const STAFF: Role[] = ["management", "sales", "procurement", "finance"];
const PURPOSE: Record<string, string> = { licence: "Licence", tin_certificate: "TIN certificate", company_document: "Company document", bank_letter: "Bank letter" };
const mask = (s: string) => (s.length <= 4 ? s : `••••${s.slice(-4)}`);

/**
 * "Portal" card on a client's or supplier's page: who has access (management invites and removes),
 * which library documents they see, and for suppliers the documents and bank details they sent.
 * Shows nothing before the portal SQL is run, or for roles that do not work with the portal.
 */
export async function PortalAccess({
  supabase,
  companyId,
  role,
  features,
  party,
  partyId,
  contacts = [],
}: {
  supabase: Supabase;
  companyId: string;
  role: RoleSet;
  features: Features;
  party: "client" | "supplier";
  partyId: string;
  contacts?: { id: string; name: string | null; email: string | null; position: string | null; phone: string | null }[];
}) {
  if (!hasRole(role, ...STAFF)) return null;
  const key = party === "client" ? "client_portal" : "supplier_portal";
  const field = party === "client" ? "client_id" : "supplier_id";
  const back = `/${party === "client" ? "clients" : "suppliers"}/${partyId}#portal`;
  const isManager = hasRole(role, "management");
  const canShare = hasRole(role, "management", party === "client" ? "sales" : "procurement");

  const { data: userData, error } = await supabase
    .from("portal_users")
    .select("id, name, email, position, status, invited_at, last_sign_in_at")
    .eq("company_id", companyId)
    .eq(field, partyId)
    .order("status")
    .order("name");
  if (error) return null; // the portal SQL has not been run yet
  const people = (userData ?? []) as PortalUser[];
  const on = features.on(key);
  if (!on && people.length === 0) {
    return isManager ? (
      <section className="card" id="portal">
        <h2>{tr(party === "client" ? "Client portal" : "Supplier portal")}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {tr(
            party === "client"
              ? "Let this client see quotations, accept them online, follow deliveries and download invoices."
              : "Let this supplier answer requests for prices, confirm orders and send invoices online.",
          )}{" "}
          <Link href="/settings/features">{tr("Switch it on in Features →")}</Link>
        </p>
      </section>
    ) : null;
  }

  const [{ data: docData }, { data: sharedData }, files, banks] = await Promise.all([
    supabase.from("documents").select("id, title, kind, file_path").eq("company_id", companyId).eq(field, partyId).is("archived_at", null).order("title").limit(50),
    supabase.from("portal_shared_documents").select("document_id").eq("company_id", companyId).eq(field, partyId),
    party === "supplier"
      ? supabase
          .from("portal_files")
          .select("id, purpose, title, file_name, expires_on, created_at")
          .eq("company_id", companyId)
          .eq("supplier_id", partyId)
          .not("stored_at", "is", null)
          .in("purpose", ["licence", "tin_certificate", "company_document", "bank_letter"])
          .order("created_at", { ascending: false })
          .limit(30)
          .then((r) => (r.data ?? []) as PFile[])
      : Promise.resolve([] as PFile[]),
    party === "supplier"
      ? supabase
          .from("supplier_bank_details")
          .select("id, status, bank_name, account_number, currency, requested_at, decided_at")
          .eq("company_id", companyId)
          .eq("supplier_id", partyId)
          .in("status", ["pending", "approved"])
          .then((r) => (r.data ?? []) as Bank[])
      : Promise.resolve([] as Bank[]),
  ]);
  const docs = ((docData ?? []) as Doc[]).filter((d) => d.file_path);
  const shared = new Set(((sharedData ?? []) as { document_id: string }[]).map((s) => s.document_id));
  const active = people.filter((p) => p.status === "active");
  const invited = new Set(active.map((p) => p.email.toLowerCase()));
  const suggest = contacts.filter((c) => c.email && !invited.has(c.email.toLowerCase()));

  return (
    <section className="card" id="portal">
      <h2>{tr(party === "client" ? "Client portal" : "Supplier portal")}</h2>
      {!on && <p className="notice notice-error small">{tr("The portal is switched off: these people cannot sign in until it is on again.")}</p>}

      {people.length === 0 ? (
        <p className="small muted">{tr("Nobody from here has portal access yet.")}</p>
      ) : (
        <ul className="list">
          {people.map((p) => (
            <li key={p.id} className="row">
              <span style={{ minWidth: 0 }}>
                <strong>{p.name}</strong>
                {p.position ? <span className="small muted"> · {p.position}</span> : null}
                <br />
                <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                  {p.email} ·{" "}
                  {p.status === "revoked"
                    ? tr("Access removed")
                    : p.last_sign_in_at
                      ? `${tr("Last signed in")} ${formatDateTime(p.last_sign_in_at)}`
                      : `${tr("Invited")} ${formatDate(p.invited_at)}`}
                </span>
              </span>
              {isManager && p.status === "active" && (
                <form action={revokePortal}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="back" value={back} />
                  <SubmitButton className="btn btn-small btn-danger" pendingText={tr("Removing…")}>
                    {tr("Remove access")}
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {isManager && on && (
        <details style={{ marginTop: 8 }} open={people.length === 0}>
          <summary className="small" style={{ fontWeight: 600, cursor: "pointer" }}>
            {tr("Invite to portal")}
          </summary>
          {suggest.length > 0 && (
            <div className="small" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
              {suggest.map((c) => (
                <form key={c.id} action={inviteToPortal}>
                  <input type="hidden" name="party" value={party} />
                  <input type="hidden" name="party_id" value={partyId} />
                  <input type="hidden" name="contact_id" value={party === "client" ? c.id : ""} />
                  <input type="hidden" name="name" value={c.name ?? c.email ?? ""} />
                  <input type="hidden" name="email" value={c.email ?? ""} />
                  <input type="hidden" name="position" value={c.position ?? ""} />
                  <input type="hidden" name="phone" value={c.phone ?? ""} />
                  <input type="hidden" name="back" value={back} />
                  <SubmitButton className="btn btn-small" pendingText={tr("Inviting…")}>
                    + {c.name ?? c.email}
                  </SubmitButton>
                </form>
              ))}
            </div>
          )}
          <form action={inviteToPortal} style={{ marginTop: 8 }}>
            <input type="hidden" name="party" value={party} />
            <input type="hidden" name="party_id" value={partyId} />
            <input type="hidden" name="back" value={back} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor={`pi-name-${partyId}`}>{tr("Name")}</label>
                <input id={`pi-name-${partyId}`} name="name" type="text" required maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor={`pi-email-${partyId}`}>{tr("Email")}</label>
                <input id={`pi-email-${partyId}`} name="email" type="email" required maxLength={200} />
              </div>
              <div className="field">
                <label htmlFor={`pi-pos-${partyId}`}>
                  {tr("Position")} <span className="hint">{tr("optional")}</span>
                </label>
                <input id={`pi-pos-${partyId}`} name="position" type="text" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor={`pi-phone-${partyId}`}>
                  {tr("Phone")} <span className="hint">{tr("optional")}</span>
                </label>
                <input id={`pi-phone-${partyId}`} name="phone" type="tel" maxLength={40} />
              </div>
            </div>
            <SubmitButton className="btn btn-primary" pendingText={tr("Inviting…")}>
              {tr("Invite to portal")}
            </SubmitButton>
            <p className="hint">{tr("They get an email with the portal address. They sign in with a one-time code; no password.")}</p>
          </form>
        </details>
      )}

      {docs.length > 0 && (
        <>
          <h3 className="small" style={{ margin: "14px 0 4px" }}>{tr("Documents on their portal")}</h3>
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id} className="row">
                <Link href={`/documents/${d.id}`}>{d.title}</Link>
                {canShare ? (
                  <form action={shareDocument}>
                    <input type="hidden" name="document_id" value={d.id} />
                    <input type="hidden" name="party" value={party} />
                    <input type="hidden" name="party_id" value={partyId} />
                    <input type="hidden" name="share" value={shared.has(d.id) ? "false" : "true"} />
                    <input type="hidden" name="back" value={back} />
                    <SubmitButton className={`btn btn-small${shared.has(d.id) ? "" : " btn-ghost"}`} pendingText={tr("Saving…")}>
                      {shared.has(d.id) ? tr("Shared ✓") : tr("Share")}
                    </SubmitButton>
                  </form>
                ) : (
                  <span className="small muted">{shared.has(d.id) ? tr("Shared") : tr("Not shared")}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {party === "supplier" && banks.length > 0 && (
        <>
          <h3 className="small" style={{ margin: "14px 0 4px" }}>{tr("Bank details")}</h3>
          <ul className="list">
            {banks.map((b) => (
              <li key={b.id} className="row">
                <span>
                  {b.bank_name} {mask(b.account_number)} ({b.currency})
                </span>
                {b.status === "pending" ? (
                  <Link className="badge tone-warn" href={`/portal-admin/bank/${b.id}`}>
                    {tr("Waiting for approval")}
                  </Link>
                ) : (
                  <span className="badge tone-ok">{tr("Approved")}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {files.length > 0 && (
        <>
          <h3 className="small" style={{ margin: "14px 0 4px" }}>{tr("Sent through the portal")}</h3>
          <ul className="list">
            {files.map((f) => (
              <li key={f.id} className="row">
                <a href={`/portal-admin/file/${f.id}`} target="_blank" rel="noopener">
                  {f.title || f.file_name}
                </a>
                <span className="small muted">
                  {tr(PURPOSE[f.purpose] ?? "Document")}
                  {f.expires_on ? ` · ${tr("Expires")} ${formatDate(f.expires_on)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
