import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LinkedDocuments } from "@/components/LinkedDocuments";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { OPEN_STAGES, TENDER_BADGE, darDateTime } from "@/lib/crm";
import { closingIn } from "@/lib/crmText";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { companyPeople, namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { addTask, removeTask, saveTender, setTenderStatus, toggleTask } from "../actions";
import { TenderFields } from "../TenderFields";

export const metadata = { title: "Tender" };

type Task = { id: string; title: string; due_on: string | null; done_at: string | null; done_by: string | null; sort: number };

export default async function TenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  const { data: t } = await supabase.from("tenders").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!t) notFound();
  const [{ data: taskData }, { data: clients }, people, { data: opps }, { data: contracts }] = await Promise.all([
    supabase.from("tender_tasks").select("id, title, due_on, done_at, done_by, sort").eq("tender_id", id).order("sort").order("created_at"),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(3000),
    companyPeople(supabase, company.id),
    supabase.from("opportunities").select("id, number, title, stage").eq("company_id", company.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("contracts").select("id, number, title").eq("tender_id", id).limit(10),
  ]);
  const tasks = (taskData ?? []) as Task[];
  const names = await namesFor(supabase, [t.owner_id, t.created_by, ...tasks.map((k) => k.done_by)]);
  const buyer = clients?.find((c) => c.id === t.client_id)?.name ?? t.buyer_name ?? "";
  const done = tasks.filter((k) => k.done_at).length;
  const left = closingIn(t.closing_at);
  const opp = opps?.find((o) => o.id === t.opportunity_id);
  const oppChoices = (opps ?? []).filter((o) => OPEN_STAGES.includes(o.stage) || o.id === t.opportunity_id);

  return (
    <>
      <p className="small">
        <Link href="/tenders">{tr("← Tenders")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{buyer}</h1>
        <StatusBadge map={TENDER_BADGE} status={t.status} />
      </div>
      <p style={{ margin: "4px 0" }}>{t.title}</p>
      <p className="muted small">
        {t.number}
        {t.reference && ` · ${t.reference}`}
        {t.category && ` · ${t.category}`}
        {t.owner_id && names.get(t.owner_id) && ` · ${names.get(t.owner_id)}`}
      </p>
      <p className={t.status === "preparing" && left.urgent ? "text-warn" : undefined}>
        <strong>{tr("Closes")}</strong> {darDateTime(t.closing_at)}
        {t.status === "preparing" && ` · ${left.text}`}
        {t.submission && <span className="small muted"> · {t.submission}</span>}
      </p>
      {(t.site_visit_at || t.clarification_by) && (
        <p className="small">
          {t.site_visit_at && `${tr("Site visit / pre-bid meeting")}: ${darDateTime(t.site_visit_at)}`}
          {t.site_visit_at && t.clarification_by && " · "}
          {t.clarification_by && `${tr("Questions to the buyer by")} ${formatDate(t.clarification_by)}`}
        </p>
      )}
      <p className="small">
        {t.bid_security !== null && `${tr("Bid security")}: ${formatMoney(t.bid_security, t.currency)} · `}
        {t.estimated_value !== null && `${tr("Estimated value")}: ${formatMoney(t.estimated_value, t.currency)} · `}
        {t.our_price !== null ? `${tr("Our bid price")}: ${formatMoney(t.our_price, t.currency)}` : tr("Our price not entered yet")}
      </p>
      {opp && (
        <p className="small">
          {tr("Opportunity")}: <Link href={`/crm/${opp.id}`}>{opp.number} · {opp.title}</Link>
        </p>
      )}
      <Notice {...notice} />
      {(t.status === "won" || t.status === "lost") && (
        <div className={`banner small ${t.status === "won" ? "ok" : "warn"}`}>
          {t.status === "won" ? tr("Won") : tr("Lost")}
          {t.decided_at && ` · ${formatDateTime(t.decided_at)}`}
          {t.winner && ` · ${tr("Winner")}: ${t.winner}`}
          {t.winning_price !== null && ` · ${tr("Winning price")}: ${formatMoney(t.winning_price, t.currency)}`}
          {t.our_price !== null && t.winning_price !== null && t.status === "lost" && Number(t.our_price) > 0 && (
            <> · {tr("we were")} {Math.round(((Number(t.our_price) - Number(t.winning_price)) / Number(t.winning_price)) * 1000) / 10}% {tr("higher")}</>
          )}
          {t.result_note && ` · ${t.result_note}`}
        </div>
      )}

      <section className="card" id="checklist">
        <h2>
          {tr("Checklist")} <span className="small muted">· {done}/{tasks.length}</span>
        </h2>
        <ul className="checklist">
          {tasks.map((k) => (
            <li key={k.id}>
              <form action={toggleTask}>
                <input type="hidden" name="tender_id" value={t.id} />
                <input type="hidden" name="task_id" value={k.id} />
                <input type="hidden" name="done" value={k.done_at ? "0" : "1"} />
                <button type="submit" className={`tick${k.done_at ? " on" : ""}`} aria-label={k.done_at ? tr("Mark as not done") : tr("Mark as done")}>
                  {k.done_at ? "✓" : ""}
                </button>
              </form>
              <span style={{ flex: 1 }}>
                <span className={k.done_at ? "done" : undefined}>{tr(k.title)}</span>
                {k.due_on && <span className="small muted"> · {formatDate(k.due_on)}</span>}
                {k.done_at && k.done_by && names.get(k.done_by) && <span className="small muted"> · {names.get(k.done_by)}</span>}
              </span>
              {!k.done_at && (
                <form action={removeTask}>
                  <input type="hidden" name="tender_id" value={t.id} />
                  <input type="hidden" name="task_id" value={k.id} />
                  <button type="submit" className="btn btn-small" aria-label={tr("Remove")} title={tr("Remove")}>
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form action={addTask} className="inline-form" style={{ marginTop: 8 }}>
          <input type="hidden" name="tender_id" value={t.id} />
          <input name="title" type="text" required minLength={2} maxLength={200} placeholder={tr("Add a step, e.g. Samples to the buyer")} />
          <input name="due_on" type="date" aria-label={tr("By")} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Add")}
          </SubmitButton>
        </form>
      </section>

      <section className="card" id="result">
        <h2>{tr("Status")}</h2>
        {t.status === "preparing" && (
          <>
            <form action={setTenderStatus} className="inline-form">
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="status" value="submitted" />
              <input name="our_price" type="text" inputMode="decimal" defaultValue={t.our_price ?? ""} placeholder={tr("Our bid price")} aria-label={tr("Our bid price")} required />
              <SubmitButton className="btn btn-primary btn-small" pendingText="…">
                {tr("Mark as submitted")}
              </SubmitButton>
            </form>
            <details style={{ marginTop: 8 }}>
              <summary className="small">{tr("We will not bid")}</summary>
              <form action={setTenderStatus} className="inline-form" style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value="no_bid" />
                <input name="note" type="text" maxLength={500} placeholder={tr("Why? e.g. not our products, no time")} />
                <SubmitButton className="btn btn-small" pendingText="…">
                  {tr("Not bidding")}
                </SubmitButton>
              </form>
            </details>
          </>
        )}
        {t.status === "submitted" && (
          <>
            <p className="small muted">
              {tr("Submitted")} {t.submitted_at && formatDateTime(t.submitted_at)}. {tr("Record the result when the buyer announces it.")}
            </p>
            <form action={setTenderStatus} className="inline-form">
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="status" value="won" />
              <input name="note" type="text" maxLength={500} placeholder={tr("Note, e.g. award letter number")} />
              <SubmitButton className="btn btn-primary btn-small" pendingText="…">
                {tr("We won")}
              </SubmitButton>
            </form>
            <details style={{ marginTop: 8 }} open>
              <summary className="small">{tr("We lost")}</summary>
              <form action={setTenderStatus} className="grid grid-2" style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value="lost" />
                <div className="field">
                  <label htmlFor="winner">{tr("Who won")}</label>
                  <input id="winner" name="winner" type="text" maxLength={200} />
                </div>
                <div className="field">
                  <label htmlFor="winning_price">{tr("Winning price")}</label>
                  <input id="winning_price" name="winning_price" type="text" inputMode="decimal" />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="note">{tr("Why we lost")}</label>
                  <input id="note" name="note" type="text" maxLength={500} placeholder={tr("Price, papers missing, delivery time…")} />
                </div>
                <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                  {tr("Record as lost")}
                </SubmitButton>
              </form>
            </details>
            <details style={{ marginTop: 8 }}>
              <summary className="small">{tr("Cancelled by the buyer")}</summary>
              <form action={setTenderStatus} className="inline-form" style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value="cancelled" />
                <input name="note" type="text" maxLength={500} placeholder={tr("Note")} />
                <SubmitButton className="btn btn-small" pendingText="…">
                  {tr("Cancelled")}
                </SubmitButton>
              </form>
            </details>
          </>
        )}
        {t.status === "won" && (
          <p>
            {(contracts ?? []).length > 0 ? (
              (contracts ?? []).map((k) => (
                <Link key={k.id} href={`/contracts/${k.id}`} style={{ marginRight: 8 }}>
                  {k.number} · {k.title}
                </Link>
              ))
            ) : (
              <Link href={`/contracts/new?tender=${t.id}${t.client_id ? `&client=${t.client_id}` : ""}`} className="btn btn-primary btn-small">
                {tr("Add the contract and its prices")}
              </Link>
            )}
          </p>
        )}
        {t.status !== "preparing" && (
          <form action={setTenderStatus} className="actions">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="status" value={t.status === "submitted" ? "preparing" : "submitted"} />
            {t.status === "submitted" ? (
              <SubmitButton className="btn btn-small" pendingText="…">
                {tr("Back to preparing")}
              </SubmitButton>
            ) : (
              t.status !== "no_bid" && (
                <SubmitButton className="btn btn-small" pendingText="…">
                  {tr("Correct the result")}
                </SubmitButton>
              )
            )}
          </form>
        )}
        {t.status === "no_bid" && (
          <form action={setTenderStatus} className="actions">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="status" value="preparing" />
            <SubmitButton className="btn btn-small" pendingText="…">
              {tr("Prepare a bid after all")}
            </SubmitButton>
          </form>
        )}
      </section>

      <LinkedDocuments supabase={supabase} companyId={company.id} field="tender_id" id={t.id} back={`/tenders/${t.id}#documents`} kind="tender" />

      <details className="card">
        <summary>{tr("Edit details")}</summary>
        <form action={saveTender} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={t.id} />
          <TenderFields
            v={t}
            clients={(clients ?? []) as { id: string; name: string }[]}
            people={people.filter((p) => p.role === "sales" || p.role === "management" || p.id === t.owner_id)}
            opportunities={oppChoices as { id: string; number: string; title: string }[]}
            base={company.base_currency}
          />
          <SubmitButton>{tr("Save")}</SubmitButton>
        </form>
      </details>
    </>
  );
}
