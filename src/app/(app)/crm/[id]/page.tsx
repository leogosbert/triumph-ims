import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { OPEN_STAGES, OPP_BADGE, OPP_STAGES, daysUntil, sourceLabel, tenderStatusLabel } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { companyPeople, namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, StatusBadge, quoteNo } from "@/lib/sales";
import { convertProspect, linkQuotation, moveOpportunity, quoteOpportunity, saveOpportunity } from "../actions";
import { ActivityForm, type ActivityRow } from "../ActivityForm";
import { OpportunityFields } from "../OpportunityFields";
import { Timeline } from "../Timeline";

export const metadata = { title: "Opportunity" };

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  const { data: o } = await supabase.from("opportunities").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!o) notFound();

  const [{ data: acts }, { data: clients }, people, { data: quote }, { data: quotes }, { data: tenders }, { data: client }] = await Promise.all([
    supabase
      .from("crm_activities")
      .select("id, kind, happened_on, summary, location, next_action, next_on, created_by")
      .eq("opportunity_id", id)
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(3000),
    companyPeople(supabase, company.id),
    o.quotation_id
      ? supabase.from("quotations").select("id, number, revision, status, total, currency, valid_until").eq("id", o.quotation_id).maybeSingle()
      : Promise.resolve({ data: null }),
    o.client_id && !o.quotation_id
      ? supabase
          .from("quotations")
          .select("id, number, revision, status, total, currency")
          .eq("company_id", company.id)
          .eq("client_id", o.client_id)
          .in("status", ["draft", "pending_approval", "approved", "sent"])
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    supabase.from("tenders").select("id, number, title, status, closing_at").eq("opportunity_id", id).limit(10),
    o.client_id ? supabase.from("clients").select("id, name").eq("id", o.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const activities = (acts ?? []) as ActivityRow[];
  const names = await namesFor(supabase, [...activities.map((a) => a.created_by), o.owner_id, o.created_by]);
  const isOpen = OPEN_STAGES.includes(o.stage);
  const party = client?.name ?? o.prospect_name ?? "";
  const nextDays = daysUntil(o.next_on);

  return (
    <>
      <p className="small">
        <Link href="/crm">{tr("← Pipeline")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{party}</h1>
        <StatusBadge map={OPP_BADGE} status={o.stage} />
      </div>
      <p style={{ margin: "4px 0" }}>{o.title}</p>
      <p className="muted small">
        {o.number} · {formatMoney(o.value, o.currency)} · {o.probability}% {tr("chance")} · {tr(sourceLabel(o.source))}
        {o.expected_close && ` · ${tr("expected")} ${formatDate(o.expected_close)}`}
        {o.owner_id && names.get(o.owner_id) && ` · ${names.get(o.owner_id)}`}
      </p>
      {client && (
        <p className="small">
          <Link href={`/clients/${client.id}`}>{tr("Open client")}</Link>
        </p>
      )}
      {(o.contact_name || o.contact_phone || o.contact_email) && (
        <p className="small">
          {o.contact_name}
          {o.contact_phone && (
            <>
              {" · "}
              <a href={`tel:${o.contact_phone.replace(/\s+/g, "")}`}>{o.contact_phone}</a>
            </>
          )}
          {o.contact_email && (
            <>
              {" · "}
              <a href={`mailto:${o.contact_email}`}>{o.contact_email}</a>
            </>
          )}
        </p>
      )}
      <Notice {...notice} />
      {o.stage === "lost" && o.lost_reason && (
        <div className="banner warn small">
          {tr("Lost:")} {o.lost_reason} · {o.closed_at ? formatDateTime(o.closed_at) : ""}
        </div>
      )}
      {o.stage === "won" && o.closed_at && <div className="banner ok small">{tr("Won on")} {formatDateTime(o.closed_at)} 🎉</div>}

      {isOpen && (
        <section className="card">
          <h2>{tr("Next step")}</h2>
          {o.next_on || o.next_action ? (
            <p className={nextDays !== null && nextDays <= 0 ? "text-warn" : undefined}>
              → {o.next_action ?? tr("Follow up")}
              {o.next_on && ` · ${formatDate(o.next_on)}`}
              {nextDays !== null && nextDays < 0 && ` · ${tr("late")}`}
            </p>
          ) : (
            <p className="muted small">{tr("No next step planned. Log a call or visit below and say what happens next.")}</p>
          )}
          <h3 style={{ marginTop: 12 }}>{tr("Move to")}</h3>
          <div className="actions" style={{ marginTop: 0 }}>
            {OPP_STAGES.filter((s) => s.key !== o.stage && s.key !== "lost").map((s) => (
              <form key={s.key} action={moveOpportunity}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="stage" value={s.key} />
                <SubmitButton className={`btn btn-small${s.key === "won" ? " btn-primary" : ""}`} pendingText="…">
                  {tr(s.label)}
                </SubmitButton>
              </form>
            ))}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="small">{tr("Mark as lost")}</summary>
            <form action={moveOpportunity} className="inline-form" style={{ marginTop: 6 }}>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="stage" value="lost" />
              <input name="reason" type="text" required maxLength={500} placeholder={tr("Why? Price, delivery time, competitor…")} />
              <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                {tr("Lost")}
              </SubmitButton>
            </form>
          </details>
        </section>
      )}
      {!isOpen && (
        <form action={moveOpportunity} className="actions">
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="stage" value="negotiation" />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Reopen")}
          </SubmitButton>
        </form>
      )}

      <section className="card" id="quotation">
        <h2>{tr("Quotation")}</h2>
        {quote ? (
          <p>
            <Link href={`/quotations/${quote.id}`}>{quoteNo(quote)}</Link> · {formatMoney(quote.total, quote.currency)} ·{" "}
            <StatusBadge map={QUOTE_STATUS} status={quote.status} />
            <br />
            <span className="small muted">{tr("When the client accepts or rejects this quotation, the opportunity is won or lost by itself.")}</span>
          </p>
        ) : !o.client_id ? (
          <>
            <p className="muted small">{tr("This is a prospect, not a client yet. Make them a client to send a quotation.")}</p>
            <form action={convertProspect}>
              <input type="hidden" name="id" value={o.id} />
              <SubmitButton className="btn btn-small">{tr("Make this prospect a client")}</SubmitButton>
            </form>
          </>
        ) : (
          <>
            {can(role, "editSales") && isOpen && (
              <form action={quoteOpportunity} className="actions" style={{ marginTop: 0 }}>
                <input type="hidden" name="id" value={o.id} />
                <SubmitButton className="btn btn-primary btn-small">{tr("Start a quotation")}</SubmitButton>
              </form>
            )}
            {(quotes ?? []).length > 0 && (
              <form action={linkQuotation} className="inline-form" style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={o.id} />
                <select name="quotation_id" aria-label={tr("Quotation")} defaultValue="">
                  <option value="" disabled>
                    {tr("Or link an existing quotation…")}
                  </option>
                  {(quotes ?? []).map((q) => (
                    <option key={q.id} value={q.id}>
                      {quoteNo(q)} · {formatMoney(q.total, q.currency)}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn btn-small" pendingText="…">
                  {tr("Link")}
                </SubmitButton>
              </form>
            )}
          </>
        )}
        {(tenders ?? []).length > 0 && (
          <p className="small">
            {tr("Tender")}:{" "}
            {(tenders ?? []).map((t) => (
              <Link key={t.id} href={`/tenders/${t.id}`} style={{ marginRight: 8 }}>
                {t.number} · {tr(tenderStatusLabel(t.status))}
              </Link>
            ))}
          </p>
        )}
      </section>

      <section className="card" id="log">
        <h2>{tr("Log a call, visit or message")}</h2>
        <ActivityForm back={`/crm/${o.id}`} opportunityId={o.id} />
      </section>

      <section className="card" id="history">
        <h2>{tr("History")}</h2>
        <Timeline rows={activities} names={names} />
        <p className="small muted" style={{ marginTop: 8 }}>
          {tr("Added by")} {names.get(o.created_by) ?? "—"} · {formatDateTime(o.created_at)}
        </p>
      </section>

      <details className="card">
        <summary>{tr("Edit details")}</summary>
        <form action={saveOpportunity} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={o.id} />
          <OpportunityFields
            v={o}
            clients={(clients ?? []) as { id: string; name: string }[]}
            people={people.filter((p) => p.role === "sales" || p.role === "management" || p.id === o.owner_id)}
            base={company.base_currency}
          />
          <SubmitButton>{tr("Save")}</SubmitButton>
        </form>
      </details>
    </>
  );
}
