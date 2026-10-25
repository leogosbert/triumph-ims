import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { aiReady } from "@/lib/ai/claude";
import { getAppContext } from "@/lib/context";
import { darDateTime } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { daysLeft } from "@/lib/growth-tools/dates";
import { DECISION_LABEL, sameBuyer, type Reason } from "@/lib/growth-tools/tenderMatch";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { dismissNotice, makeTender, readAgain, restoreNotice, saveNotice } from "../actions";
import "../../../../growth-tools.css";

export const metadata = { title: "Tender notice" };

const BY: Record<string, string> = { ai: "Read with AI", rules: "Read with the built-in rules", person: "Checked by a person" };

/** "2026-11-20T10:00:00+03:00" -> ["2026-11-20", "10:00"] in Dar es Salaam time. */
function darParts(iso: string | null): [string, string] {
  if (!iso) return ["", ""];
  const d = new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString();
  return [d.slice(0, 10), d.slice(11, 16)];
}

export default async function NoticePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features, isManager } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  if (!features.on("tender_alerts")) return <FeatureOff title="Tender alerts" isManager={isManager} />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: n } = await supabase.from("tender_notices").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!n) notFound();
  const [{ data: clients }, { data: source }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("company_id", company.id).eq("active", true).order("name").limit(3000),
    n.source_id ? supabase.from("tender_sources").select("name, url").eq("id", n.source_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const reasons = (Array.isArray(n.reasons) ? n.reasons : []) as Reason[];
  const missing = reasons.filter((r) => r.kind === "papers" && !r.ok);
  const d = n.decision ? DECISION_LABEL[n.decision as keyof typeof DECISION_LABEL] : null;
  const left = daysLeft(n.closing_at);
  const guess = (clients ?? []).find((c) => sameBuyer(c.name, n.buyer));
  const [cDate, cTime] = darParts(n.closing_at);
  const open = n.status === "new" || n.status === "matched" || n.status === "expired";

  return (
    <>
      <p className="small">
        <Link href="/tenders/alerts">{tr("← Tender alerts")}</Link>
      </p>
      <div className="gt-head">
        {n.score !== null && <span className={`gt-score ${d?.tone ?? "off"}`}>{n.score}</span>}
        <div className="gt-main">
          <h1 style={{ margin: 0 }}>{n.title ?? tr("Tender notice")}</h1>
          <p className="muted small" style={{ margin: "4px 0" }}>
            {n.buyer ?? tr("Buyer not found")}
            {n.reference && ` · ${n.reference}`}
            {n.category && ` · ${n.category}`}
          </p>
        </div>
        {d && n.status === "matched" ? <StatusBadge map={DECISION_LABEL} status={n.decision} /> : null}
      </div>
      <Notice {...notice} />
      {n.status === "converted" && n.tender_id && (
        <div className="banner ok small">
          {tr("This notice is a tender now.")} <Link href={`/tenders/${n.tender_id}`}>{tr("Open the tender")}</Link>
        </div>
      )}
      {n.status === "dismissed" && (
        <div className="banner small">
          {tr("Dismissed")}
          {n.dismissed_reason && ` · ${tr(n.dismissed_reason)}`}
          {n.decided_at && ` · ${formatDateTime(n.decided_at)}`}
        </div>
      )}
      {n.status === "new" && <div className="banner small">{tr("Not read yet. It is read within the hour, or tap Read now.")}</div>}

      <section className="card">
        <p style={{ marginTop: 0 }} className={left !== null && left >= 0 && left < 3 ? "text-warn" : undefined}>
          <strong>{tr("Closes")}</strong> {n.closing_at ? darDateTime(n.closing_at) : tr("not found: check the advert")}
          {left !== null && left >= 0 && ` · ${left === 0 ? tr("today") : `${left} ${tr("days left")}`}`}
          {left !== null && left < 0 && ` · ${tr("closed")}`}
        </p>
        <dl className="kv">
          {n.location && (
            <>
              <dt>{tr("Delivery / site")}</dt>
              <dd>{n.location}</dd>
            </>
          )}
          {n.published_on && (
            <>
              <dt>{tr("Published")}</dt>
              <dd>{formatDate(n.published_on)}</dd>
            </>
          )}
          {n.bid_security && (
            <>
              <dt>{tr("Bid security")}</dt>
              <dd>{n.bid_security}</dd>
            </>
          )}
          <dt>{tr("Source")}</dt>
          <dd>
            {n.source === "email" && n.inbox_message_id ? (
              <Link href="/inbox">{tr("Email in the Inbox")}</Link>
            ) : n.source === "web" ? (
              source?.name ?? tr("Web page")
            ) : (
              tr("Pasted")
            )}
            {n.url && (
              <>
                {" · "}
                <a href={n.url} target="_blank" rel="noopener noreferrer nofollow">
                  {tr("Open the advert")}
                </a>
              </>
            )}
          </dd>
          {n.extracted_by && (
            <>
              <dt>{tr("Read")}</dt>
              <dd>
                {tr(BY[n.extracted_by] ?? n.extracted_by)}
                {n.extracted_at && ` · ${formatDateTime(n.extracted_at)}`}
              </dd>
            </>
          )}
        </dl>
        {n.summary && <p className="small">{n.summary}</p>}
      </section>

      {reasons.length > 0 && (
        <section className="card">
          <h2>{tr("Why this score")}</h2>
          <ul className="gt-reasons">
            {reasons.map((r, i) => (
              <li key={i} className={r.ok ? undefined : "bad"}>
                <span>{tr(r.text)}</span>
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="small" style={{ marginBottom: 0 }}>
              <Link href="/compliance/checklist">{tr("Open the compliance checklist")}</Link> {tr("to get the missing papers ready.")}
            </p>
          )}
        </section>
      )}

      {n.documents_required?.length > 0 && (
        <section className="card">
          <h2>{tr("Papers the notice asks for")}</h2>
          <ul className="gt-chips">
            {(n.documents_required as string[]).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <section className="card">
          <h2>{tr("Decide")}</h2>
          <form action={makeTender} className="grid grid-2">
            <input type="hidden" name="id" value={n.id} />
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="client_id">{tr("Client")}</label>
              <select id="client_id" name="client_id" defaultValue={guess?.id ?? ""}>
                <option value="">{n.buyer ? `${tr("Not a client yet")}: ${n.buyer}` : tr("Choose the client")}</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="closing_date">{tr("Closing date")}</label>
              <input id="closing_date" name="closing_date" type="date" defaultValue={cDate} required />
            </div>
            <div className="field">
              <label htmlFor="closing_time">{tr("Time")}</label>
              <input id="closing_time" name="closing_time" type="time" defaultValue={cTime || "10:00"} />
            </div>
            <SubmitButton className="btn btn-primary" pendingText="…">
              {tr("Make tender")}
            </SubmitButton>
          </form>
          <form action={dismissNotice} className="inline-form" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={n.id} />
            <input name="reason" type="text" maxLength={300} placeholder={tr("Why not? e.g. not our products")} aria-label={tr("Reason")} />
            <SubmitButton className="btn btn-small" pendingText="…">
              {tr("No bid")}
            </SubmitButton>
          </form>
        </section>
      )}
      {n.status === "dismissed" && (
        <form action={restoreNotice} style={{ margin: "12px 0" }}>
          <input type="hidden" name="id" value={n.id} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Put back in the list")}
          </SubmitButton>
        </form>
      )}

      {n.status !== "converted" && (
        <section className="card">
          <h2>{tr("Read again")}</h2>
          <div className="gt-share">
            {aiReady() && (
              <form action={readAgain}>
                <input type="hidden" name="id" value={n.id} />
                <input type="hidden" name="ai" value="1" />
                <SubmitButton className="btn btn-small" pendingText={tr("Reading…")}>
                  {n.status === "new" ? tr("Read now with AI") : tr("Read again with AI")}
                </SubmitButton>
              </form>
            )}
            <form action={readAgain}>
              <input type="hidden" name="id" value={n.id} />
              <input type="hidden" name="ai" value="0" />
              <SubmitButton className="btn btn-small" pendingText="…">
                {n.status === "new" ? tr("Read now") : tr("Score again")}
              </SubmitButton>
            </form>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="small">{tr("Correct the details")}</summary>
            <form action={saveNotice} className="grid grid-2" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={n.id} />
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="title">{tr("Title")}</label>
                <input id="title" name="title" type="text" maxLength={300} defaultValue={n.title ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="buyer">{tr("Buyer")}</label>
                <input id="buyer" name="buyer" type="text" maxLength={200} defaultValue={n.buyer ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="reference">{tr("Tender number")}</label>
                <input id="reference" name="reference" type="text" maxLength={120} defaultValue={n.reference ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="category">{tr("Category")}</label>
                <input id="category" name="category" type="text" maxLength={120} defaultValue={n.category ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="location">{tr("Delivery / site")}</label>
                <input id="location" name="location" type="text" maxLength={160} defaultValue={n.location ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="e_closing_date">{tr("Closing date")}</label>
                <input id="e_closing_date" name="closing_date" type="date" defaultValue={cDate} />
              </div>
              <div className="field">
                <label htmlFor="e_closing_time">{tr("Time")}</label>
                <input id="e_closing_time" name="closing_time" type="time" defaultValue={cTime} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="bid_security">{tr("Bid security")}</label>
                <input id="bid_security" name="bid_security" type="text" maxLength={200} defaultValue={n.bid_security ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="documents_required">
                  {tr("Papers asked for")} <span className="hint">{tr("one per line")}</span>
                </label>
                <textarea id="documents_required" name="documents_required" rows={5} defaultValue={(n.documents_required ?? []).join("\n")} />
              </div>
              <SubmitButton className="btn btn-primary btn-small" pendingText="…">
                {tr("Save and score")}
              </SubmitButton>
            </form>
          </details>
        </section>
      )}

      {n.raw_text && (
        <details className="card">
          <summary>{tr("The notice as received")}</summary>
          <div className="gt-raw">{n.raw_text}</div>
        </details>
      )}
    </>
  );
}
