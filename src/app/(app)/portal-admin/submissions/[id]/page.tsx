import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { reviewSubmission } from "../../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Supplier document" };

type Sub = {
  id: string;
  kind: "invoice" | "delivery_note";
  status: string;
  supplier_id: string;
  supplier_invoice_no: string | null;
  reference: string | null;
  doc_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  bill_id: string | null;
  created_at: string;
  supplier: { name: string } | null;
  po: { id: string; number: string; total: number; currency: string } | null;
  portal_user: { name: string; email: string } | null;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: "To check", tone: "warn" },
  billed: { label: "Bill made", tone: "ok" },
  accepted: { label: "Checked", tone: "ok" },
  rejected: { label: "Sent back", tone: "bad" },
};

/** An invoice or delivery note from the supplier portal. Finance turns an invoice into a draft bill here. */
export default async function PortalSubmission({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!["management", "procurement", "finance", "warehouse"].includes(role)) redirect("/");
  const { data } = await supabase
    .from("portal_submissions")
    .select("*, supplier:suppliers(name), po:purchase_orders(id, number, total, currency), portal_user:portal_users(name, email)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!data) notFound();
  const s = data as unknown as Sub;
  const { data: fileData } = await supabase
    .from("portal_files")
    .select("id, file_name, size_bytes")
    .eq("submission_id", id)
    .eq("company_id", company.id)
    .not("stored_at", "is", null)
    .order("created_at");
  const files = (fileData ?? []) as { id: string; file_name: string; size_bytes: number | null }[];
  const st = STATUS[s.status] ?? STATUS.submitted;
  const canBill = s.kind === "invoice" && (role === "management" || role === "finance");
  const canCheck = role !== "warehouse";
  const open = s.status === "submitted";

  return (
    <>
      <BackLink href="/portal-admin" label="Portals" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>
          {s.kind === "invoice" ? `${tr("Invoice")} ${s.supplier_invoice_no ?? ""}` : `${tr("Delivery note")} ${s.reference ?? ""}`}
        </h1>
        <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
      </div>
      <Notice {...notice} />
      <section className="card">
        <dl className="kv">
          <dt>{tr("Supplier")}</dt>
          <dd>
            <Link href={`/suppliers/${s.supplier_id}`}>{s.supplier?.name}</Link>
          </dd>
          {s.portal_user && (
            <>
              <dt>{tr("Sent by")}</dt>
              <dd>
                {s.portal_user.name} · {s.portal_user.email} · {formatDateTime(s.created_at)}
              </dd>
            </>
          )}
          {s.po && (
            <>
              <dt>{tr("Purchase order")}</dt>
              <dd>
                <Link href={`/purchase-orders/${s.po.id}`}>{s.po.number}</Link> · {formatMoney(s.po.total, s.po.currency)}
              </dd>
            </>
          )}
          <dt>{s.kind === "invoice" ? tr("Invoice date") : tr("Delivery date")}</dt>
          <dd>{formatDate(s.doc_date)}</dd>
          {s.due_date && (
            <>
              <dt>{tr("Due")}</dt>
              <dd>{formatDate(s.due_date)}</dd>
            </>
          )}
          {s.kind === "invoice" && (
            <>
              <dt>{tr("Before VAT")}</dt>
              <dd>{formatMoney(s.subtotal, s.currency)}</dd>
              <dt>{tr("VAT")}</dt>
              <dd>{formatMoney(s.vat_amount, s.currency)}</dd>
              <dt>{tr("Total")}</dt>
              <dd>
                <strong>{formatMoney(s.total, s.currency)}</strong>
                {s.po && s.po.currency === s.currency && Math.abs(Number(s.po.total) - Number(s.total)) > 0.01 && (
                  <span className="badge tone-warn" style={{ marginLeft: 6 }}>
                    {tr("Differs from the order")}
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
        {s.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{s.notes}</p>}
        {files.length > 0 ? (
          <p className="small" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {files.map((f) => (
              <a key={f.id} href={`/portal-admin/file/${f.id}`} target="_blank" rel="noopener">
                📎 {f.file_name}
              </a>
            ))}
          </p>
        ) : (
          <p className="small text-warn">{tr("No file arrived with this document.")}</p>
        )}
        {s.bill_id && (
          <p className="small">
            <Link href={`/bills/${s.bill_id}`}>{tr("Open the bill →")}</Link>
          </p>
        )}
        {s.review_note && !open && (
          <p className="small muted">
            {tr("Note")}: {s.review_note} {s.reviewed_at ? `· ${formatDateTime(s.reviewed_at)}` : ""}
          </p>
        )}
      </section>

      {open && canCheck && (
        <section className="card">
          <h2>{tr("Check it")}</h2>
          <form action={reviewSubmission}>
            <input type="hidden" name="id" value={s.id} />
            {canBill && (
              <div className="field">
                <label htmlFor="rs-due">
                  {tr("Due date for the bill")} <span className="hint">{tr("leave empty to keep the supplier's")}</span>
                </label>
                <input id="rs-due" name="due_date" type="date" defaultValue={s.due_date ?? ""} />
              </div>
            )}
            <div className="field">
              <label htmlFor="rs-note">
                {tr("Note")} <span className="hint">{tr("needed to send it back; the supplier sees it")}</span>
              </label>
              <textarea id="rs-note" name="note" maxLength={1000} rows={2} />
            </div>
            <div className="actions">
              {canBill && (
                <SubmitButton className="btn btn-primary" name="action" value="bill" pendingText={tr("Working…")}>
                  {tr("Make draft bill")}
                </SubmitButton>
              )}
              <SubmitButton className="btn" name="action" value="accept" pendingText={tr("Working…")}>
                {tr("Mark as checked")}
              </SubmitButton>
              <SubmitButton className="btn btn-danger" name="action" value="reject" pendingText={tr("Working…")}>
                {tr("Send back")}
              </SubmitButton>
            </div>
            {s.kind === "invoice" && !canBill && <p className="hint">{tr("Finance or management turns an invoice into a bill.")}</p>}
          </form>
        </section>
      )}
    </>
  );
}
