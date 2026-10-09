import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { methodLabel, n } from "@/lib/finance";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { saveExpense, voidExpense } from "../actions";
import { ExpenseFields } from "../ExpenseFields";
import { ReceiptPicker } from "../ReceiptPicker";

export const metadata = { title: "Expense" };

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const { data: e } = await supabase.from("expenses").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!e) notFound();
  const [{ data: catData }, names] = await Promise.all([
    supabase.from("expense_categories").select("id, name, active").eq("company_id", company.id).order("sort").order("name"),
    namesFor(supabase, [e.created_by, e.voided_by, e.reconciled_by]),
  ]);
  const categories = (catData ?? []) as { id: string; name: string; active: boolean }[];
  const category = categories.find((c) => c.id === e.category_id);

  let receiptUrl: string | null = null;
  if (e.receipt_path) receiptUrl = (await supabase.storage.from("receipts").createSignedUrl(e.receipt_path, 3600)).data?.signedUrl ?? null;
  const isPdf = typeof e.receipt_path === "string" && e.receipt_path.endsWith(".pdf");

  const manage = can(role, "manageExpenses");
  const editable = !e.voided_at;
  const base = company.base_currency;

  return (
    <>
      <p className="small">
        <Link href="/expenses">{tr("← Expenses")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0, ...(e.voided_at ? { textDecoration: "line-through" } : {}) }}>{e.description}</h1>
        <div className="head-amount num">{formatMoney(e.amount, e.currency)}</div>
      </div>
      <p className="muted small">
        {e.number} · {tr(category?.name ?? "")} · {formatDate(e.spent_on)} · {tr(methodLabel(e.method, e.provider))}
        {e.reference && ` · ${e.reference}`}
        {e.payee && ` · ${e.payee}`}
      </p>
      {e.currency !== base && (
        <p className="small muted">
          ≈ {formatMoney(n(e.amount) * n(e.exchange_rate), base)} {tr("at")} {n(e.exchange_rate)}
        </p>
      )}
      <p className="small muted">
        {tr("Recorded by")} {names.get(e.created_by) ?? "—"} · {formatDateTime(e.created_at)}
        {e.reconciled_at && (
          <>
            {" · "}
            <span className="text-ok">
              ✓ {tr("checked against the statement")} ({names.get(e.reconciled_by) ?? ""})
            </span>
          </>
        )}
      </p>
      <Notice {...notice} />
      {e.voided_at && (
        <div className="banner warn small">
          {tr("Voided:")} {e.void_reason} · {names.get(e.voided_by) ?? ""} · {formatDateTime(e.voided_at)}
        </div>
      )}

      <section className="card" id="receipt">
        <h2>{tr("Receipt")}</h2>
        {receiptUrl ? (
          isPdf ? (
            <p>
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="btn btn-small">
                {tr("Open receipt (PDF)")}
              </a>
            </p>
          ) : (
            <a href={receiptUrl} target="_blank" rel="noreferrer">
              <img src={receiptUrl} alt={tr("Receipt")} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, display: "block" }} />
            </a>
          )
        ) : (
          <p className="muted small">{tr("No receipt photo yet.")}</p>
        )}
        {editable && <ReceiptPicker companyId={company.id} expenseId={e.id} hasReceipt={!!e.receipt_path} />}
      </section>

      <section className="card" id="details">
        <h2>{tr("Details")}</h2>
        {e.reconciled_at && !e.voided_at && (
          <p className="small muted">{tr("Checked against the statement: the amount, date and payment details can no longer be changed.")}</p>
        )}
        <form action={saveExpense}>
          <input type="hidden" name="id" value={e.id} />
          <fieldset className="plain" disabled={!editable}>
            <ExpenseFields
              base={base}
              categories={categories}
              withProvider
              lockMoney={!!e.reconciled_at}
              v={{
                category_id: e.category_id,
                spent_on: e.spent_on,
                payee: e.payee,
                description: e.description,
                amount: n(e.amount),
                vat_amount: n(e.vat_amount),
                currency: e.currency,
                exchange_rate: n(e.exchange_rate),
                method: e.method,
                provider: e.provider,
                reference: e.reference,
                notes: e.notes,
              }}
            />
            {editable && <SubmitButton>{tr("Save")}</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {editable && manage && (
        <details className="card">
          <summary>{tr("Void this expense")}</summary>
          <p className="small muted">{tr("A voided expense stays on record, struck through, and no longer counts in the totals.")}</p>
          <form action={voidExpense} className="inline-form">
            <input type="hidden" name="id" value={e.id} />
            <input name="reason" type="text" placeholder={tr("Reason")} required />
            <SubmitButton className="btn btn-small btn-danger" pendingText="…">
              {tr("Void")}
            </SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
