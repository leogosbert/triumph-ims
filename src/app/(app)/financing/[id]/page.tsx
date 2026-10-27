import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { SharePdfButton } from "@/components/SharePdfButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { coverPct, estimatedInterest, FACILITY_LABEL, FIN_STATUS, nextSteps } from "@/lib/growth-tools/financing";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { quoteNo, StatusBadge, todayTz } from "@/lib/sales";
import { deleteRequest, saveRequest, setRequestStatus } from "../actions";
import { RequestFields } from "../RequestFields";
import { BackLink } from "@/components/BackLink";
import "../../../growth-tools.css";

export const metadata = { title: "Financing request" };

const FLOW = ["draft", "submitted", "approved", "disbursed", "repaid"];

export default async function FinancingRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, features, isManager } = await getAppContext();
  if (!can(roles, "seeFinance")) noAccess();
  if (!features.on("lpo_financing")) return <FeatureOff title="LPO financing" isManager={isManager} />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: f } = await supabase
    .from("financing_requests")
    .select("*, client:clients(name), quotation:quotations(id, number, revision, total, currency, client_ref)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!f) notFound();
  const q = f.quotation as { id: string; number: string; revision: number; total: number; currency: string; client_ref: string | null } | null;
  const client = (f.client as { name: string } | null)?.name ?? "";
  const [{ data: docs }, { data: invoices }, { data: lpoDoc }] = await Promise.all([
    supabase.from("documents").select("id, title, kind").eq("company_id", company.id).eq("client_id", f.client_id).is("archived_at", null).not("file_path", "is", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("invoices").select("id, number, total, currency, status").eq("company_id", company.id).eq("client_id", f.client_id).not("status", "in", "(draft,cancelled)").order("issue_date", { ascending: false }).limit(30),
    f.lpo_document_id ? supabase.from("documents").select("id, title").eq("id", f.lpo_document_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const amount = Number(f.approved_amount ?? f.amount);
  const interest = estimatedInterest(amount, f.interest_rate === null ? null : Number(f.interest_rate), f.tenor_days);
  const cover = coverPct(Number(f.amount), f.lpo_amount === null ? Number(q?.total ?? 0) : Number(f.lpo_amount));
  const today = todayTz();
  const closed = ["repaid", "declined", "cancelled"].includes(f.status);
  const steps = nextSteps(f.status);
  const reached = FLOW.indexOf(f.status);
  const fileName = `${f.number} financing pack ${client}.pdf`.replace(/[^\w.\- ]+/g, "");
  const invoice = (invoices ?? []).find((i) => i.id === f.invoice_id);
  const back = `/financing/${f.id}`;

  return (
    <>
      <BackLink href="/financing" label="LPO financing" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{client}</h1>
        <StatusBadge map={FIN_STATUS} status={f.status} />
      </div>
      <p className="muted small">
        {f.number} · {f.bank_name}
        {f.bank_branch && `, ${f.bank_branch}`} · {tr(FACILITY_LABEL[f.facility] ?? f.facility)}
      </p>
      <ul className="gt-steps" aria-label={tr("Progress")}>
        {FLOW.map((s, i) => (
          <li key={s} className={s === f.status ? "now" : reached >= 0 && i < reached ? "on" : undefined}>
            {tr(FIN_STATUS[s].label)}
          </li>
        ))}
      </ul>
      <Notice {...notice} />
      {f.status === "disbursed" && f.repayment_due && (
        <div className={`banner small ${f.repayment_due < today ? "warn" : ""}`}>
          {f.repayment_due < today ? tr("Repayment overdue since") : tr("Repay by")} {formatDate(f.repayment_due)}
          {invoice && ` · ${tr("from invoice")} ${invoice.number}`}
        </div>
      )}
      {f.status === "declined" && f.decision_note && <div className="banner warn small">{tr("Bank's reason")}: {f.decision_note}</div>}

      <section className="card">
        <h2>{tr("Financing pack")}</h2>
        <p className="small muted">
          {tr("One PDF for the bank: cover letter, summary with cost and margin, the LPO, our quotation, supplier quotes, the client's payment record and statement, cash summary and company papers.")}
        </p>
        {!f.lpo_document_id && <p className="small text-warn">{tr("The LPO copy is not attached yet: add it below so it is in the pack.")}</p>}
        <div className="gt-share">
          <a href={`/financing/${f.id}/pack`} target="_blank" rel="noopener" className="btn btn-small">
            {tr("Open the pack")}
          </a>
          <SharePdfButton href={`/financing/${f.id}/pack`} fileName={fileName} title={`${f.number} ${client}`} />
        </div>
      </section>

      <section className="card">
        <dl className="kv">
          <dt>{tr("Amount")}</dt>
          <dd>
            {formatMoney(Number(f.amount), f.currency)}
            {cover !== null && <span className="small muted"> · {cover}% {tr("of the order")}</span>}
          </dd>
          {f.approved_amount !== null && (
            <>
              <dt>{tr("Approved")}</dt>
              <dd>
                {formatMoney(Number(f.approved_amount), f.currency)}
                {f.approved_on && ` · ${formatDate(f.approved_on)}`}
              </dd>
            </>
          )}
          <dt>{tr("Tenor")}</dt>
          <dd>
            {f.tenor_days} {tr("days")}
            {f.interest_rate !== null && ` · ${Number(f.interest_rate)}% ${tr("a year")}`}
            {interest !== null && <span className="small muted"> · {tr("about")} {formatMoney(interest, f.currency)} {tr("interest")}</span>}
          </dd>
          <dt>{tr("Order")}</dt>
          <dd>
            {q && <Link href={`/quotations/${q.id}`}>{quoteNo(q)}</Link>}
            {f.lpo_number && ` · LPO ${f.lpo_number}`}
            {f.lpo_date && ` · ${formatDate(f.lpo_date)}`}
            {` · ${formatMoney(Number(f.lpo_amount ?? q?.total ?? 0), f.currency)}`}
          </dd>
          <dt>{tr("LPO copy")}</dt>
          <dd>{lpoDoc ? <Link href={`/documents/${lpoDoc.id}`}>{lpoDoc.title}</Link> : tr("Not attached")}</dd>
          {f.submitted_on && (
            <>
              <dt>{tr("Submitted")}</dt>
              <dd>{formatDate(f.submitted_on)}</dd>
            </>
          )}
          {f.disbursed_on && (
            <>
              <dt>{tr("Money received")}</dt>
              <dd>{formatDate(f.disbursed_on)}</dd>
            </>
          )}
          {f.repaid_on && (
            <>
              <dt>{tr("Repaid")}</dt>
              <dd>{formatDate(f.repaid_on)}</dd>
            </>
          )}
          {f.bank_reference && (
            <>
              <dt>{tr("Bank reference")}</dt>
              <dd>{f.bank_reference}</dd>
            </>
          )}
          <dt>{tr("Repaid from")}</dt>
          <dd>{tr(f.repayment_source)}</dd>
        </dl>
        {f.notes && <p className="small">{f.notes}</p>}
      </section>

      {steps.length > 0 && (
        <section className="card">
          <h2>{tr("Next step")}</h2>
          {steps.map((s) => (
            <form key={s.to} action={setRequestStatus} className="inline-form" style={{ marginBottom: 8 }}>
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="status" value={s.to} />
              {s.needs === "date" && <input name="on" type="date" defaultValue={today} max={today} aria-label={tr("Date")} />}
              {s.needs === "amount" && (
                <>
                  <input name="approved_amount" type="text" inputMode="decimal" placeholder={`${tr("Approved amount")} (${formatMoney(Number(f.amount), f.currency)})`} aria-label={tr("Approved amount")} />
                  <input name="bank_reference" type="text" maxLength={120} placeholder={tr("Bank reference")} aria-label={tr("Bank reference")} />
                </>
              )}
              {s.to === "disbursed" && (
                <select name="invoice_id" defaultValue={f.invoice_id ?? ""} aria-label={tr("Repaid from invoice")}>
                  <option value="">{tr("Invoice that repays it (optional)")}</option>
                  {(invoices ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number} · {formatMoney(i.total, i.currency)}
                    </option>
                  ))}
                </select>
              )}
              {s.needs === "note" && <input name="note" type="text" required maxLength={500} placeholder={tr("The bank's reason")} aria-label={tr("Reason")} />}
              <SubmitButton className={`btn btn-small${s.tone === "danger" ? " btn-danger" : " btn-primary"}`} pendingText="…">
                {tr(s.label)}
              </SubmitButton>
            </form>
          ))}
        </section>
      )}

      {!closed && (
        <details className="card">
          <summary>{tr("Change the details")}</summary>
          <form action={saveRequest} className="grid grid-2" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={f.id} />
            <RequestFields start={f} currency={f.currency} docs={docs ?? []} uploadHref={`/documents/new?client=${f.client_id}&kind=other&back=${encodeURIComponent(back)}`} edit />
            <SubmitButton className="btn btn-primary btn-small" pendingText="…">
              {tr("Save")}
            </SubmitButton>
          </form>
        </details>
      )}

      {isManager && (f.status === "draft" || f.status === "cancelled") && (
        <form action={deleteRequest} style={{ marginTop: 16 }}>
          <input type="hidden" name="id" value={f.id} />
          <SubmitButton className="btn btn-small btn-danger" pendingText="…">
            {tr("Delete request")}
          </SubmitButton>
        </form>
      )}
    </>
  );
}
