import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { FISCAL_STATUS } from "@/lib/getpaid/common";
import { vfdEnv, vfdConfigured } from "@/lib/getpaid/tra-vfd";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { primeLang, tr } from "@/lib/tr";
import { cancelCreditNote, registerVfd, retryFiscal, saveFiscalSettings, sendFiscalQueue } from "../actions";
import { FeatureOff, GetPaidTabs, Ready } from "../parts";

export const metadata = { title: "TRA receipts" };

type Settings = {
  mode: "manual" | "vfd";
  environment: "test" | "live";
  tin: string | null;
  vrn: string | null;
  cert_serial: string | null;
  vfd_serial: string | null;
  zero_tax_code: number;
  reg_id: string | null;
  registered_at: string | null;
  global_counter: number;
};
type Receipt = {
  id: string;
  kind: string;
  mode: string;
  status: string;
  receipt_no: string | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  total_incl: number;
  created_at: string;
  invoice: { id: string; number: string } | null;
};
type Day = { day: string; receipts: number; credit_notes: number; total_excl: number; vat_amount: number; total_incl: number; typed: number; posted: number; waiting: number; failed: number; zreport_status: string | null };
type CreditNote = { id: string; number: string; issued_on: string; amount: number; reason: string; status: string; invoice: { id: string; number: string; currency: string } | null };

export default async function TraPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager, features } = await getAppContext();
  if (!can(roles, "seeFinance")) noAccess();

  const [setRes, queueRes, daysRes, cnRes] = await Promise.all([
    supabase.from("fiscal_settings").select("*").eq("company_id", company.id).maybeSingle(),
    supabase
      .from("fiscal_receipts")
      .select("id, kind, mode, status, receipt_no, attempts, last_error, next_attempt_at, total_incl, created_at, invoice:invoices(id, number)")
      .eq("company_id", company.id)
      .in("status", ["pending", "queued", "posting", "failed"])
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.rpc("fiscal_daily_totals", { p_company: company.id, p_from: null, p_to: null }),
    supabase
      .from("credit_notes")
      .select("id, number, issued_on, amount, reason, status, invoice:invoices(id, number, currency)")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  if (isMissingTable(setRes.error)) return <NotReady title="TRA receipts" />;
  const s = setRes.data as Settings | null;
  const queue = (queueRes.data ?? []) as unknown as Receipt[];
  const days = (daysRes.data ?? []) as Day[];
  const credits = (cnRes.data ?? []) as unknown as CreditNote[];
  const serverVfd = vfdConfigured();
  const serverTinMatches = serverVfd && s?.tin ? vfdEnv()?.tin === s.tin : false;
  const edit = can(roles, "editInvoices");

  return (
    <>
      <h1>{tr("TRA receipts")}</h1>
      <p className="muted">{tr("Every issued invoice needs its TRA fiscal receipt. Type it from your EFD machine, or let the app send it to TRA (VFD).")}</p>
      <Notice msg={notice.msg} error={notice.error} />
      <GetPaidTabs current="/getting-paid/tra" />
      {!features.on("tra_fiscal") && <FeatureOff name="TRA fiscal receipts" isManager={isManager} />}

      <section className="card">
        <h2>{tr("How you issue receipts")}</h2>
        <form action={saveFiscalSettings}>
          <fieldset disabled={!isManager} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="mode">{tr("Receipts")}</label>
                <select id="mode" name="mode" defaultValue={s?.mode ?? "manual"}>
                  <option value="manual">{tr("Manual: we use an EFD machine and type the receipt")}</option>
                  <option value="vfd">{tr("VFD: the app sends each invoice to TRA")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="tin">{tr("Company TIN")}</label>
                <input id="tin" name="tin" type="text" inputMode="numeric" placeholder="123-456-789" defaultValue={s?.tin ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="vrn">{tr("VRN (if registered for VAT)")}</label>
                <input id="vrn" name="vrn" type="text" defaultValue={s?.vrn ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="zero_tax_code">{tr("Invoices without VAT are")}</label>
                <select id="zero_tax_code" name="zero_tax_code" defaultValue={String(s?.zero_tax_code ?? 5)}>
                  <option value="5">{tr("E: exempt")}</option>
                  <option value="3">{tr("C: zero rated")}</option>
                  <option value="4">{tr("D: special relief")}</option>
                </select>
              </div>
            </div>
            <details open={s?.mode === "vfd"}>
              <summary>
                <strong>{tr("VFD details from TRA")}</strong>
              </summary>
              <div className="grid grid-2" style={{ marginTop: 12 }}>
                <div className="field">
                  <label htmlFor="cert_serial">{tr("Certificate serial")}</label>
                  <input id="cert_serial" name="cert_serial" type="text" defaultValue={s?.cert_serial ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="vfd_serial">{tr("VFD serial (certificate key)")}</label>
                  <input id="vfd_serial" name="vfd_serial" type="text" placeholder="10TZ101807" defaultValue={s?.vfd_serial ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="environment">{tr("TRA service")}</label>
                  <select id="environment" name="environment" defaultValue={s?.environment ?? "test"}>
                    <option value="test">{tr("Test (try it first)")}</option>
                    <option value="live">{tr("Live")}</option>
                  </select>
                </div>
              </div>
              <p className="small muted">{tr("Changing the TIN, the serials or the service after registering means registering again.")}</p>
            </details>
            {isManager && <SubmitButton pendingText={tr("Saving…")}>{tr("Save TRA settings")}</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {s?.mode === "vfd" && (
        <section className="card">
          <h2>{tr("VFD connection")}</h2>
          <ul className="list">
            <Ready ok={serverVfd} label="TRA certificate on the server" hint="LeMo Tech adds TRA_VFD_PRIVATE_KEY and TRA_VFD_TIN in Netlify." />
            <Ready ok={serverTinMatches} label="The certificate is for this company's TIN" hint="The certificate on the server belongs to another TIN, or the TIN above is missing." />
            <Ready ok={Boolean(s.reg_id)} label="Registered with TRA" hint="Press Register once the two lines above are ready." />
          </ul>
          {s.reg_id ? (
            <p className="small muted">
              {tr("Registration")} {s.reg_id} · {s.registered_at ? formatDateTime(s.registered_at) : ""} · {tr("last receipt number")} {s.global_counter} · {tr(s.environment === "live" ? "Live" : "Test")}
            </p>
          ) : null}
          <div className="row" style={{ gap: 8, justifyContent: "flex-start" }}>
            {isManager && serverTinMatches && (
              <form action={registerVfd}>
                <SubmitButton className="btn" pendingText={tr("Registering…")}>{s.reg_id ? tr("Register again") : tr("Register with TRA")}</SubmitButton>
              </form>
            )}
            {edit && s.reg_id && (
              <form action={sendFiscalQueue}>
                <SubmitButton className="btn" pendingText={tr("Sending…")}>{tr("Send waiting receipts now")}</SubmitButton>
              </form>
            )}
          </div>
          <p className="small muted">{tr("Not yet checked against TRA's live service: try the test service first and compare a receipt with TRA's verification page.")}</p>
        </section>
      )}

      <section className="card">
        <h2>
          {tr("Waiting for a receipt")} ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <p className="muted small">{tr("Nothing waiting.")}</p>
        ) : (
          <ul className="list">
            {queue.map((r) => (
              <li key={r.id}>
                <div className="row">
                  <span>
                    {r.invoice ? <Link href={`/invoices/${r.invoice.id}#fiscal`}>{r.invoice.number}</Link> : "—"}
                    {r.kind === "credit_note" ? ` · ${tr("credit note")}` : ""} · {formatMoney(r.total_incl, "TZS")}{" "}
                    <StatusBadge map={FISCAL_STATUS} status={r.status} />
                  </span>
                  {edit && r.mode === "vfd" && (r.status === "failed" || r.status === "queued") && (
                    <form action={retryFiscal}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="back" value="/getting-paid/tra" />
                      <SubmitButton className="btn btn-small" pendingText="…">{tr("Try again")}</SubmitButton>
                    </form>
                  )}
                </div>
                {r.last_error ? (
                  <div className="small text-warn">
                    {r.last_error} · {tr("tries")}: {r.attempts}
                    {r.next_attempt_at && r.status === "failed" ? ` · ${tr("next try")} ${formatDateTime(r.next_attempt_at)}` : ""}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{tr("Daily totals (Z report)")}</h2>
        {days.length === 0 ? (
          <p className="muted small">{tr("No receipts in the last 30 days.")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="compare">
              <thead>
                <tr>
                  <th>{tr("Day")}</th>
                  <th>{tr("Receipts")}</th>
                  <th>{tr("Credit notes")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Before VAT")}</th>
                  <th style={{ textAlign: "right" }}>{tr("VAT")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Total")}</th>
                  <th>{tr("Waiting")}</th>
                  {s?.mode === "vfd" && <th>{tr("Z report")}</th>}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <td>{formatDate(d.day)}</td>
                    <td>{d.receipts}</td>
                    <td>{d.credit_notes}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(d.total_excl, "TZS")}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(d.vat_amount, "TZS")}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(d.total_incl, "TZS")}</td>
                    <td className={d.waiting + d.failed > 0 ? "text-warn" : undefined}>{d.waiting + d.failed}</td>
                    {s?.mode === "vfd" && <td>{d.zreport_status ? tr(d.zreport_status === "posted" ? "Sent" : d.zreport_status === "failed" ? "Not sent yet" : "Waiting") : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">{tr("Amounts in TZS as TRA receives them. Use these totals to check your VAT return.")}</p>
      </section>

      <section className="card">
        <h2>{tr("Credit notes")}</h2>
        <p className="small muted">{tr("Issue a credit note from the invoice it corrects (Invoices, open the invoice, Credit note).")}</p>
        {credits.length === 0 ? (
          <p className="muted small">{tr("No credit notes yet.")}</p>
        ) : (
          <ul className="list">
            {credits.map((c) => (
              <li key={c.id}>
                <div className="row">
                  <span>
                    <strong style={c.status === "cancelled" ? { textDecoration: "line-through" } : undefined}>{c.number}</strong> · {formatDate(c.issued_on)} ·{" "}
                    {formatMoney(c.amount, c.invoice?.currency ?? "TZS")} · {c.invoice ? <Link href={`/invoices/${c.invoice.id}`}>{c.invoice.number}</Link> : "—"}
                    <div className="small muted">{c.reason}</div>
                  </span>
                </div>
                {isManager && c.status === "issued" && (
                  <details className="small">
                    <summary>{tr("Cancel this credit note")}</summary>
                    <form action={cancelCreditNote} className="inline-form" style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="back" value="/getting-paid/tra" />
                      <input name="reason" type="text" placeholder={tr("Reason")} required />
                      <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Cancel credit note")}</SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
