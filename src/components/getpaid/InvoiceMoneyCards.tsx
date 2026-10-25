import { SubmitButton } from "@/components/SubmitButton";
import { cancelPayLink, issueCreditNote, makePayLink, recordFiscalReceipt, setInvoiceReminders, startFiscal } from "@/app/(app)/getting-paid/actions";
import type { Company } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { FISCAL_STATUS, payLinkUrl } from "@/lib/getpaid/common";
import { waDigits } from "@/lib/inbox/whatsapp";
import { formatMoney } from "@/lib/money";
import { can, type Role } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import type { createClient } from "@/lib/supabase/server";
import { tr } from "@/lib/tr";
import { QrSvg } from "./QrSvg";
import { ShareLink } from "./ShareLink";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Receipt = {
  id: string;
  kind: string;
  credit_note_id: string | null;
  mode: string;
  status: string;
  receipt_no: string | null;
  z_number: string | null;
  verification_code: string | null;
  receipt_at: string | null;
  verify_url: string | null;
  last_error: string | null;
};
type CreditNote = { id: string; number: string; issued_on: string; amount: number; reason: string; status: string };

export type MoneyInvoice = {
  id: string;
  number: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  client_id: string;
  client_name: string;
  contact_name: string | null;
  no_reminders?: boolean;
};

/**
 * Getting paid on one invoice: the TRA receipt (with its QR code), credit notes, the pay link with its
 * share buttons, and the "do not remind" switch. Each part shows only when its feature is on.
 */
export async function InvoiceMoneyCards({
  supabase,
  company,
  role,
  on,
  inv,
}: {
  supabase: Supabase;
  company: Company;
  role: Role;
  on: (key: string) => boolean;
  inv: MoneyInvoice;
}) {
  if (inv.status === "draft" || inv.status === "cancelled") return null;
  const fiscalOn = on("tra_fiscal");
  const payOn = on("pay_links");
  const remindOn = on("auto_reminders");
  if (!fiscalOn && !payOn && !remindOn) return null;

  const [rcRes, setRes, cnRes, linkRes, contactsRes, invRes] = await Promise.all([
    supabase
      .from("fiscal_receipts")
      .select("id, kind, credit_note_id, mode, status, receipt_no, z_number, verification_code, receipt_at, verify_url, last_error")
      .eq("invoice_id", inv.id)
      .neq("status", "void")
      .order("created_at"),
    supabase.from("fiscal_settings").select("mode").eq("company_id", company.id).maybeSingle(),
    supabase.from("credit_notes").select("id, number, issued_on, amount, reason, status").eq("invoice_id", inv.id).order("created_at"),
    supabase.from("pay_links").select("code, status").eq("invoice_id", inv.id).in("status", ["active", "paid"]).order("created_at", { ascending: false }).limit(1),
    supabase.from("client_contacts").select("kind, phone, email").eq("client_id", inv.client_id).order("created_at").limit(20),
    supabase.from("invoices").select("no_reminders").eq("id", inv.id).maybeSingle(),
  ]);
  if (isMissingTable(rcRes.error) || isMissingTable(linkRes.error)) return null;

  const receipts = (rcRes.data ?? []) as Receipt[];
  const receipt = receipts.find((r) => r.kind === "receipt") ?? null;
  const credits = (cnRes.data ?? []) as CreditNote[];
  const link = ((linkRes.data ?? []) as { code: string; status: string }[])[0] ?? null;
  const contacts = (contactsRes.data ?? []) as { kind: string; phone: string | null; email: string | null }[];
  const finance = [...contacts].sort((a, b) => Number(b.kind === "finance") - Number(a.kind === "finance"));
  const phone = waDigits(finance.find((c) => c.phone)?.phone ?? null);
  const email = finance.find((c) => c.email)?.email ?? null;
  const noReminders = Boolean((invRes.data as { no_reminders?: boolean } | null)?.no_reminders ?? inv.no_reminders);
  const edit = can(role, "editInvoices");
  const open = inv.status === "issued" || inv.status === "partly_paid";
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const back = `/invoices/${inv.id}`;

  const receiptForm = (creditNoteId: string | null, current: Receipt | null) => (
    <form action={recordFiscalReceipt} style={{ marginTop: 8 }}>
      <input type="hidden" name="invoice_id" value={inv.id} />
      {creditNoteId && <input type="hidden" name="credit_note_id" value={creditNoteId} />}
      <input type="hidden" name="back" value={`${back}#fiscal`} />
      <div className="grid grid-2">
        <div className="field">
          <label>{tr("Receipt number")}</label>
          <input name="receipt_no" type="text" required defaultValue={current?.receipt_no ?? ""} />
        </div>
        <div className="field">
          <label>
            {tr("Verification code")} <span className="hint">· {tr("or the scanned TRA link")}</span>
          </label>
          <input name="verification_code" type="text" required defaultValue={current?.verification_code ?? ""} />
        </div>
        <div className="field">
          <label>{tr("Receipt date")}</label>
          <input name="receipt_date" type="date" defaultValue={current?.receipt_at?.slice(0, 10) ?? todayTz()} />
        </div>
        <div className="field">
          <label>{tr("Time on the receipt")}</label>
          <input name="receipt_time" type="time" step={1} />
        </div>
        <div className="field">
          <label>{tr("Z number (optional)")}</label>
          <input name="z_number" type="text" defaultValue={current?.z_number ?? ""} />
        </div>
      </div>
      <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>{tr("Save TRA receipt")}</SubmitButton>
    </form>
  );

  return (
    <>
      {fiscalOn && (
        <section className="card" id="fiscal">
          <h2>{tr("TRA receipt")}</h2>
          {receipt ? (
            <>
              <p style={{ marginTop: 0 }}>
                <StatusBadge map={FISCAL_STATUS} status={receipt.status} />
                {receipt.receipt_no ? ` ${tr("Receipt")} ${receipt.receipt_no}` : ""}
                {receipt.z_number ? ` · Z ${receipt.z_number}` : ""}
                {receipt.receipt_at && (receipt.status === "posted" || receipt.status === "recorded") ? ` · ${formatDateTime(receipt.receipt_at)}` : ""}
              </p>
              {receipt.verify_url && (receipt.status === "posted" || receipt.status === "recorded") ? (
                <div className="row" style={{ gap: 16, justifyContent: "flex-start", alignItems: "center" }}>
                  <QrSvg text={receipt.verify_url} size={120} label={tr("TRA verification QR code")} />
                  <div className="small">
                    {tr("Verification code")}: <strong>{receipt.verification_code}</strong>
                    <br />
                    <a href={receipt.verify_url} target="_blank" rel="noopener noreferrer">
                      {tr("Check on the TRA website")}
                    </a>
                  </div>
                </div>
              ) : null}
              {receipt.last_error && receipt.status === "failed" ? <p className="small text-warn">{receipt.last_error}</p> : null}
              {edit && receipt.status !== "posted" && receipt.status !== "posting" && (
                <details open={receipt.status === "pending"}>
                  <summary>{receipt.status === "recorded" ? tr("Correct the receipt") : tr("Enter the receipt from the EFD machine")}</summary>
                  {receiptForm(null, receipt)}
                </details>
              )}
            </>
          ) : setRes.data ? (
            <>
              <p className="muted small">{tr("No TRA receipt on this invoice yet.")}</p>
              {edit && (
                <>
                  <form action={startFiscal}>
                    <input type="hidden" name="invoice_id" value={inv.id} />
                    <input type="hidden" name="back" value={`${back}#fiscal`} />
                    <SubmitButton className="btn btn-small" pendingText="…">{(setRes.data as { mode: string }).mode === "vfd" ? tr("Send to TRA") : tr("Add a TRA receipt")}</SubmitButton>
                  </form>
                </>
              )}
            </>
          ) : (
            <p className="muted small">
              {tr("Set up TRA receipts first:")} <a href="/getting-paid/tra">{tr("Getting paid, then TRA receipts")}</a>
            </p>
          )}

          <h3 style={{ marginTop: 16 }}>{tr("Credit notes")}</h3>
          {credits.length === 0 ? <p className="muted small">{tr("None.")}</p> : null}
          {credits.length > 0 && (
            <ul className="list">
              {credits.map((c) => {
                const rc = receipts.find((r) => r.credit_note_id === c.id) ?? null;
                return (
                  <li key={c.id}>
                    <div className="row">
                      <span>
                        <strong style={c.status === "cancelled" ? { textDecoration: "line-through" } : undefined}>{c.number}</strong> · {formatDate(c.issued_on)} · {formatMoney(c.amount, inv.currency)}
                        <div className="small muted">{c.reason}</div>
                      </span>
                      {rc ? <StatusBadge map={FISCAL_STATUS} status={rc.status} /> : null}
                    </div>
                    {edit && c.status === "issued" && rc && rc.status !== "posted" && (
                      <details className="small">
                        <summary>{rc.status === "recorded" ? tr("Correct the receipt") : tr("Enter the credit note receipt from the EFD machine")}</summary>
                        {receiptForm(c.id, rc)}
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {edit && open && (
            <details>
              <summary>{tr("+ Issue a credit note")}</summary>
              <form action={issueCreditNote} style={{ marginTop: 8 }}>
                <input type="hidden" name="invoice_id" value={inv.id} />
                <input type="hidden" name="back" value={`${back}#fiscal`} />
                <div className="grid grid-2">
                  <div className="field">
                    <label>
                      {tr("Amount (")}
                      {inv.currency})
                    </label>
                    <input name="amount" type="text" inputMode="decimal" required placeholder={String(Math.round(balance))} />
                  </div>
                  <div className="field">
                    <label>{tr("Date")}</label>
                    <input name="issued_on" type="date" defaultValue={todayTz()} />
                  </div>
                </div>
                <div className="field">
                  <label>{tr("Reason")}</label>
                  <input name="reason" type="text" required placeholder={tr("e.g. 2 items returned")} />
                </div>
                <p className="small muted">{tr("A credit note reduces what is still owed (at most the balance) and reverses the sale and its VAT in the books.")}</p>
                <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>{tr("Issue credit note")}</SubmitButton>
              </form>
            </details>
          )}
        </section>
      )}

      {payOn && open && (
        <section className="card" id="paylink">
          <h2>{tr("Pay link")}</h2>
          {link ? (
            (() => {
              const url = payLinkUrl(link.code);
              const text = `${inv.contact_name || inv.client_name}, ${tr("you can pay invoice")} ${inv.number} (${formatMoney(balance, inv.currency)}) ${tr("here")}: ${url}`;
              return (
                <>
                  <div className="row" style={{ gap: 16, justifyContent: "flex-start", alignItems: "center" }}>
                    <QrSvg text={url} size={110} label={tr("Pay link QR code")} />
                    <div className="small" style={{ overflowWrap: "anywhere" }}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {url}
                      </a>
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <ShareLink url={url} whatsappText={text} emailSubject={`${tr("Invoice")} ${inv.number} - ${company.name}`} emailBody={text} phone={phone} email={email} />
                  </div>
                  {can(role, "editInvoices") && (
                    <details className="small" style={{ marginTop: 8 }}>
                      <summary>{tr("Stop this link")}</summary>
                      <form action={cancelPayLink} style={{ marginTop: 6 }}>
                        <input type="hidden" name="invoice_id" value={inv.id} />
                        <input type="hidden" name="back" value={`${back}#paylink`} />
                        <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Stop the link")}</SubmitButton>
                      </form>
                    </details>
                  )}
                </>
              );
            })()
          ) : (
            <form action={makePayLink}>
              <input type="hidden" name="invoice_id" value={inv.id} />
              <input type="hidden" name="back" value={`${back}#paylink`} />
              <p className="muted small">{tr("A link the client opens to pay by mobile money or card.")}</p>
              <SubmitButton className="btn btn-small" pendingText="…">{tr("Create pay link")}</SubmitButton>
            </form>
          )}
        </section>
      )}

      {remindOn && open && edit && (
        <section className="card" id="autoremind">
          <div className="row">
            <span>
              <strong>{tr("Automatic reminders")}</strong>
              <div className="small muted">{noReminders ? tr("Off for this invoice.") : tr("On: sent as set in Getting paid, then Reminders.")}</div>
            </span>
            <form action={setInvoiceReminders}>
              <input type="hidden" name="invoice_id" value={inv.id} />
              <input type="hidden" name="off" value={noReminders ? "0" : "1"} />
              <input type="hidden" name="back" value={`${back}#autoremind`} />
              <SubmitButton className="btn btn-small" pendingText="…">{noReminders ? tr("Remind again") : tr("Do not remind")}</SubmitButton>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
