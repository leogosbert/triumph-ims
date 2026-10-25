import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { darDateTime, isMissingTable } from "@/lib/crm";
import { daysLeft } from "@/lib/growth-tools/dates";
import { DECISION_LABEL } from "@/lib/growth-tools/tenderMatch";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { dismissNotice } from "./actions";
import "../../../growth-tools.css";

export const metadata = { title: "Tender alerts" };

type Row = {
  id: string;
  source: string;
  title: string | null;
  buyer: string | null;
  reference: string | null;
  closing_at: string | null;
  score: number | null;
  decision: string | null;
  status: string;
  matched: string[];
  created_at: string;
  tender_id: string | null;
};

const SOURCE_LABEL: Record<string, string> = { email: "Email", web: "Web", paste: "Pasted" };
const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  new: { label: "Being read", tone: "info" },
  matched: { label: "To decide", tone: "warn" },
  converted: { label: "Tender made", tone: "ok" },
  dismissed: { label: "Dismissed", tone: "off" },
  expired: { label: "Closed", tone: "off" },
};

export default async function TenderAlertsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features, isManager } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  if (!features.on("tender_alerts")) return <FeatureOff title="Tender alerts" isManager={isManager} />;
  const view = sp.view === "done" ? "done" : sp.view === "waiting" ? "waiting" : "decide";
  const statuses = view === "done" ? ["converted", "dismissed", "expired"] : view === "waiting" ? ["new"] : ["matched"];
  const [{ data, error }, { data: summary }] = await Promise.all([
    supabase
      .from("tender_notices")
      .select("id, source, title, buyer, reference, closing_at, score, decision, status, matched, created_at, tender_id")
      .eq("company_id", company.id)
      .in("status", statuses)
      .order(view === "decide" ? "score" : "created_at", { ascending: false, nullsFirst: false })
      .limit(300),
    supabase.rpc("tender_alert_summary", { p_company: company.id }),
  ]);
  if (isMissingTable(error)) return <NotReady title="Tender alerts" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const s = (summary ?? {}) as { waiting?: number; matched?: number; bid?: number; closing_soon?: number; sources?: number; set_up?: boolean };

  return (
    <>
      <p className="small">
        <Link href="/tenders">{tr("← Tenders")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Tender alerts")}</h1>
        <Link href="/tenders/alerts/new" className="btn btn-primary btn-small">
          {tr("+ Paste a notice")}
        </Link>
      </div>
      <Notice {...notice} />
      {!s.set_up && (
        <div className="banner warn small">
          {tr("Tell the app what you sell so it can score each notice.")}{" "}
          <Link href="/tenders/alerts/settings">{tr("Set your keywords")}</Link>
        </div>
      )}
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{s.matched ?? 0}</div>
          <div className="l">{tr("To decide")}</div>
        </div>
        <div className="stat">
          <div className="n text-ok">{s.bid ?? 0}</div>
          <div className="l">{tr("Worth a bid")}</div>
        </div>
        <div className="stat">
          <div className={`n${s.closing_soon ? " text-warn" : ""}`}>{s.closing_soon ?? 0}</div>
          <div className="l">{tr("Closing within 3 days")}</div>
        </div>
        <div className="stat">
          <div className="n">{s.sources ?? 0}</div>
          <div className="l">{tr("Web sources")}</div>
        </div>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/tenders/alerts" aria-current={view === "decide" ? "page" : undefined}>
          {tr("To decide")} ({s.matched ?? 0})
        </Link>
        <Link href="/tenders/alerts?view=waiting" aria-current={view === "waiting" ? "page" : undefined}>
          {tr("Being read")} ({s.waiting ?? 0})
        </Link>
        <Link href="/tenders/alerts?view=done" aria-current={view === "done" ? "page" : undefined}>
          {tr("Done")}
        </Link>
        <Link href="/tenders/alerts/settings">{tr("Settings")}</Link>
      </nav>
      {rows.length === 0 ? (
        <div className="card muted">
          {view === "decide" ? (
            <>
              <p>{tr("No notices to decide on.")}</p>
              <p className="small">
                {tr("Forward NeST, PPRA and client tender emails to your Inbox address, add public tender pages under Settings, or paste an advert.")}
              </p>
            </>
          ) : view === "waiting" ? (
            tr("Nothing waiting. New notices are read within the hour.")
          ) : (
            tr("Nothing here yet.")
          )}
        </div>
      ) : (
        <ul className="rec-list">
          {rows.map((n) => {
            const left = daysLeft(n.closing_at);
            const d = n.decision ? DECISION_LABEL[n.decision as keyof typeof DECISION_LABEL] : null;
            return (
              <li key={n.id}>
                <Link href={`/tenders/alerts/${n.id}`}>
                  <div className="main">
                    <div className="title">{n.title ?? tr("Tender notice")}</div>
                    <div className="sub">
                      {n.buyer ?? tr("Buyer not found")}
                      {n.reference && ` · ${n.reference}`}
                    </div>
                    <div className="sub">
                      {n.closing_at ? (
                        <>
                          {tr("Closes")} {darDateTime(n.closing_at)}
                          {left !== null && left >= 0 && left < 3 && <span className="text-warn"> · {left === 0 ? tr("today") : `${left} ${tr("days")}`}</span>}
                        </>
                      ) : (
                        tr("Closing date not found")
                      )}
                      {" · "}
                      {tr(SOURCE_LABEL[n.source] ?? n.source)}
                    </div>
                    {Array.isArray(n.matched) && n.matched.length > 0 && (
                      <ul className="gt-chips">
                        {n.matched.slice(0, 4).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="side">
                    {n.score !== null && <span className={`gt-score small ${d?.tone ?? "off"}`}>{n.score}</span>}
                    {view === "decide" && d ? <StatusBadge map={DECISION_LABEL} status={n.decision!} /> : <StatusBadge map={STATUS_LABEL} status={n.status} />}
                  </div>
                </Link>
                {view === "decide" && n.decision === "no_bid" && (
                  <form action={dismissNotice} style={{ marginTop: -4, marginBottom: 8 }}>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="back" value="list" />
                    <input type="hidden" name="reason" value="No bid (score)" />
                    <button type="submit" className="btn btn-small btn-ghost">
                      {tr("Dismiss")}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
