import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { decideBankChange } from "../../actions";
import { BackLink } from "@/components/BackLink";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Bank details" };

type Bank = {
  id: string;
  supplier_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  branch: string | null;
  swift_code: string | null;
  currency: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  supplier: { name: string; phone: string | null; email: string | null } | null;
  requester: { name: string; email: string; phone: string | null } | null;
};

/**
 * New bank details sent from the supplier portal. Never used until management approves them here;
 * a classic fraud is a fake "we changed banks" message, so the page asks to call the supplier first.
 */
export default async function BankChange({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!hasRole(roles, "management") && !hasRole(roles, "finance")) redirect("/");
  const { data } = await supabase
    .from("supplier_bank_details")
    .select("*, supplier:suppliers(name, phone, email), requester:portal_users(name, email, phone)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!data) notFound();
  const b = data as unknown as Bank;
  const [{ data: currentData }, { data: letterData }] = await Promise.all([
    supabase
      .from("supplier_bank_details")
      .select("bank_name, account_name, account_number, branch, currency, decided_at")
      .eq("supplier_id", b.supplier_id)
      .eq("company_id", company.id)
      .eq("status", "approved")
      .neq("id", b.id)
      .maybeSingle(),
    supabase.from("portal_files").select("id, file_name").eq("bank_detail_id", b.id).eq("company_id", company.id).not("stored_at", "is", null),
  ]);
  const current = currentData as { bank_name: string; account_name: string; account_number: string; branch: string | null; currency: string; decided_at: string | null } | null;
  const letters = (letterData ?? []) as { id: string; file_name: string }[];
  const pending = b.status === "pending";

  return (
    <>
      <BackLink href="/portal-admin" label="Portals"> · <Link href={`/suppliers/${b.supplier_id}#portal`}>{b.supplier?.name}</Link>
      </BackLink>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{tr("New bank details")}</h1>
        <span className={`badge tone-${pending ? "warn" : b.status === "approved" ? "ok" : "off"}`}>
          {pending ? tr("Waiting for approval") : b.status === "approved" ? tr("Approved") : b.status === "rejected" ? tr("Rejected") : tr("Replaced")}
        </span>
      </div>
      <Notice {...notice} />
      {pending && (
        <p className="notice notice-error">
          {tr("Before approving, call the supplier on a number you already had (not one from this request) and confirm the new account.")}
          {b.supplier?.phone ? ` ${tr("Number on file")}: ${b.supplier.phone}.` : ""}
        </p>
      )}
      <div className="grid grid-2">
        <section className="card">
          <h2>{tr("Requested")}</h2>
          <dl className="kv">
            <dt>{tr("Bank")}</dt>
            <dd>
              {b.bank_name}
              {b.branch ? `, ${b.branch}` : ""}
            </dd>
            <dt>{tr("Account name")}</dt>
            <dd>{b.account_name}</dd>
            <dt>{tr("Account number")}</dt>
            <dd>
              <strong>{b.account_number}</strong>
            </dd>
            {b.swift_code && (
              <>
                <dt>SWIFT</dt>
                <dd>{b.swift_code}</dd>
              </>
            )}
            <dt>{tr("Currency")}</dt>
            <dd>{b.currency}</dd>
            {b.requester && (
              <>
                <dt>{tr("Sent by")}</dt>
                <dd>
                  {b.requester.name} · {b.requester.email}
                </dd>
              </>
            )}
            <dt>{tr("When")}</dt>
            <dd>{formatDateTime(b.requested_at)}</dd>
          </dl>
          {letters.map((f) => (
            <p key={f.id} className="small" style={{ margin: "8px 0 0" }}>
              <a href={`/portal-admin/file/${f.id}`} target="_blank" rel="noopener">
                📎 {f.file_name}
              </a>
            </p>
          ))}
          {letters.length === 0 && <p className="small text-warn">{tr("No letter from the bank was attached.")}</p>}
        </section>
        <section className="card">
          <h2>{tr("Account we pay now")}</h2>
          {current ? (
            <dl className="kv">
              <dt>{tr("Bank")}</dt>
              <dd>
                {current.bank_name}
                {current.branch ? `, ${current.branch}` : ""}
              </dd>
              <dt>{tr("Account name")}</dt>
              <dd>{current.account_name}</dd>
              <dt>{tr("Account number")}</dt>
              <dd>{current.account_number}</dd>
              <dt>{tr("Currency")}</dt>
              <dd>{current.currency}</dd>
            </dl>
          ) : (
            <p className="muted small">{tr("No approved bank account on record yet.")}</p>
          )}
        </section>
      </div>

      {!pending && b.decision_note && (
        <p className="small muted">
          {tr("Note")}: {b.decision_note} {b.decided_at ? `· ${formatDateTime(b.decided_at)}` : ""}
        </p>
      )}

      {pending && hasRole(roles, "management") && (
        <section className="card">
          <h2>{tr("Decision")}</h2>
          <form action={decideBankChange}>
            <input type="hidden" name="id" value={b.id} />
            <div className="field">
              <label htmlFor="bk-note">
                {tr("Note")} <span className="hint">{tr("needed to reject; the supplier sees it")}</span>
              </label>
              <textarea id="bk-note" name="note" maxLength={500} rows={2} />
            </div>
            <div className="actions">
              <SubmitButton className="btn btn-primary" name="approve" value="true" pendingText={tr("Working…")}>
                {tr("Approve new bank details")}
              </SubmitButton>
              <SubmitButton className="btn btn-danger" name="approve" value="false" pendingText={tr("Working…")}>
                {tr("Reject")}
              </SubmitButton>
            </div>
          </form>
        </section>
      )}
      {pending && !hasRole(roles, "management") && <p className="small muted">{tr("Only management can approve bank details.")}</p>}
    </>
  );
}
