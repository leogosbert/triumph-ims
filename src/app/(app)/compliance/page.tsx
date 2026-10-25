import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { daysUntil, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { addDays, canSeeCompliance, LICENCE_STATUS, num, periodLabel, type ComplianceSummary } from "@/lib/compliance/model";
import { StatusBadge } from "@/lib/sales";
import { todayTz } from "@/lib/services";
import { legalRules } from "@/lib/compliance/rules";
import { HashToGuide } from "./HashToGuide";
import { LegalHealth } from "./LegalHealth";
import { ComplianceTabs, Disclaimer } from "./parts";

export const metadata = { title: "Legal & compliance" };

type DueFiling = { id: string; due_on: string; period_start: string; period_end: string; item: { id: string; name: string } | null };
type DueItem = { id: string; name: string; due_on: string; status: string };
type ExpLicence = { id: string; name: string; authority: string | null; expires_on: string; status: string };

export default async function CompliancePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, isManager } = await getAppContext();
  if (!canSeeCompliance(role)) redirect("/");

  // Bring the calendar up to date first (harmless when nothing repeats).
  const refresh = await supabase.rpc("compliance_refresh_calendar", { p_company: company.id });
  if (isMissingTable(refresh.error)) return <NotReady title="Legal & compliance" />;
  const { data, error } = await supabase.rpc("compliance_summary", { p_company: company.id });
  if (isMissingTable(error)) return <NotReady title="Legal & compliance" />;
  if (error) throw new Error(error.message);
  const s = data as ComplianceSummary;
  const today = todayTz();
  const until = addDays(today, 30);

  const [filingsRes, itemsRes, licRes, setRes] = await Promise.all([
    supabase
      .from("compliance_deadlines")
      .select("id, due_on, period_start, period_end, item:compliance_items!inner(id, name, status)")
      .eq("company_id", company.id)
      .eq("status", "open")
      .neq("item.status", "not_applicable")
      .lte("due_on", until)
      .order("due_on")
      .limit(12),
    supabase
      .from("compliance_items")
      .select("id, name, due_on, status")
      .eq("company_id", company.id)
      .in("status", ["not_started", "in_progress"])
      .not("due_on", "is", null)
      .lte("due_on", until)
      .order("due_on")
      .limit(12),
    supabase
      .from("licences")
      .select("id, name, authority, expires_on, status")
      .eq("company_id", company.id)
      .in("status", ["active", "expired"])
      .not("expires_on", "is", null)
      .lte("expires_on", addDays(today, 90))
      .order("expires_on")
      .limit(12),
    supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle(),
  ]);
  const rules = legalRules(setRes.data?.legal_rules);
  const filings = (filingsRes.data ?? []) as unknown as DueFiling[];
  const items = (itemsRes.data ?? []) as DueItem[];
  const licences = (licRes.data ?? []) as ExpLicence[];

  const tiles = [
    { n: num(s.overdue), l: "Overdue", href: "/compliance/calendar", alert: num(s.overdue) > 0 },
    { n: num(s.due_soon), l: "Due in the next 14 days", href: "/compliance/calendar", alert: false },
    { n: num(s.licences_expiring) + num(s.licences_expired), l: "Licences expiring or expired", href: "/compliance/licences", alert: num(s.licences_expired) > 0 },
    { n: num(s.missing_docs), l: "Done but no copy uploaded", href: "/compliance/checklist?show=nocopy", alert: num(s.missing_docs) > 0 },
    { n: num(s.not_started), l: "Not started", href: "/compliance/checklist?show=open", alert: false },
    { n: num(s.licences_active), l: "Active licences", href: "/compliance/licences", alert: false },
    { n: num(s.licences_pending), l: "Licences to apply for or applied", href: "/compliance/licences?status=pending", alert: false },
    { n: num(s.documents_expiring), l: "Library papers expiring", href: "/documents?view=expiring", alert: num(s.documents_expiring) > 0 },
  ];

  return (
    <>
      <div className="page-head">
        <h1>{tr("Legal & compliance")}</h1>
        {isManager && s.set_up && (
          <Link href="/compliance/checklist/adopt" className="btn btn-small">
            {tr("+ From the catalogue")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("What the company must register, renew and file in Tanzania, with the papers to prove it.")}</p>
      <ComplianceTabs current="/compliance" />
      <HashToGuide />
      <Notice {...notice} />

      {!s.set_up ? (
        <section className="card">
          <h2>{tr("Set up your compliance checklist")}</h2>
          <p>
            {tr(
              "Start from the usual requirements for a newly registered general supply company: BRELA papers, TIN, business licence, tax returns, tax clearance, NeST registration and more. You choose what to add, and you can add sector licences (chemicals, lubricants, mining) whenever you need them.",
            )}
          </p>
          {isManager ? (
            <Link href="/compliance/checklist/adopt" className="btn btn-primary">
              {tr("Set up my checklist")}
            </Link>
          ) : (
            <p className="muted small">{tr("Ask management to set up the checklist.")}</p>
          )}
          <p className="small" style={{ marginTop: 10 }}>
            <Link href="/compliance/guide">{tr("Not sure what you need? Open the guide →")}</Link>
          </p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="line-head" style={{ alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>{tr("Compliance score")}</h2>
              <strong style={{ fontSize: "1.6rem" }}>{num(s.score)}%</strong>
            </div>
            <div className="progress-mini-track" style={{ maxWidth: "none", height: 8, marginTop: 8 }} aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.max(0, num(s.score)))}%`, background: "var(--brand)" }} />
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              {num(s.done)} {tr("of")} {num(s.applicable)} {tr("requirements done")}
              {num(s.in_progress) > 0 && ` · ${num(s.in_progress)} ${tr("in progress")}`}
              {num(s.not_applicable) > 0 && ` · ${num(s.not_applicable)} ${tr("do not apply")}`}
            </p>
          </section>
          <div className="stat-grid">
            {tiles.map((t) => (
              <Link key={t.l} href={t.href} className={`stat ${t.alert ? "alert" : ""}`}>
                <div className="n">{t.n}</div>
                <div className="l">{tr(t.l)}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      {s.set_up && <LegalHealth supabase={supabase} company={company} role={role} isManager={isManager} rules={rules} today={today} />}

      {(filings.length > 0 || items.length > 0) && (
        <section className="card">
          <h2>{tr("Overdue and due soon")}</h2>
          <ul className="lines">
            {filings.map((f) => {
              const left = daysUntil(f.due_on) ?? 0;
              return (
                <li key={f.id}>
                  <Link href="/compliance/calendar" className="line-head" style={{ color: "inherit", textDecoration: "none" }}>
                    <span>
                      <span className="desc">{f.item?.name ? tr(f.item.name) : ""}</span>
                      <span className="small muted"> · {periodLabel(f.period_start, f.period_end)}</span>
                    </span>
                    <span className={`badge tone-${left < 0 ? "bad" : left <= 7 ? "warn" : "info"}`}>
                      {left < 0 ? tr("Overdue") : left === 0 ? tr("Today") : formatDate(f.due_on)}
                    </span>
                  </Link>
                </li>
              );
            })}
            {items.map((i) => {
              const left = daysUntil(i.due_on) ?? 0;
              return (
                <li key={i.id}>
                  <Link href={`/compliance/checklist/${i.id}`} className="line-head" style={{ color: "inherit", textDecoration: "none" }}>
                    <span className="desc">{tr(i.name)}</span>
                    <span className={`badge tone-${left < 0 ? "bad" : left <= 7 ? "warn" : "info"}`}>
                      {left < 0 ? tr("Overdue") : left === 0 ? tr("Today") : formatDate(i.due_on)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {s.next_filings?.length > 0 && (
        <section className="card">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{tr("Next filings")}</h2>
            <Link href="/compliance/calendar" className="small">
              {tr("Calendar →")}
            </Link>
          </div>
          <ul className="lines">
            {s.next_filings.map((f) => (
              <li key={f.id} className="line-head">
                <span>
                  {tr(f.name)} <span className="small muted">· {f.period}</span>
                </span>
                <span className="small">{formatDate(f.due_on)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {licences.length > 0 && (
        <section className="card">
          <h2>{tr("Licences expiring")}</h2>
          <ul className="lines">
            {licences.map((l) => {
              const left = daysUntil(l.expires_on) ?? 0;
              return (
                <li key={l.id}>
                  <Link href={`/compliance/licences/${l.id}`} className="line-head" style={{ color: "inherit", textDecoration: "none" }}>
                    <span>
                      <span className="desc">{l.name}</span>
                      {l.authority && <span className="small muted"> · {l.authority}</span>}
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <StatusBadge map={LICENCE_STATUS} status={l.status} />
                      <span className={`small${left <= 30 ? " text-warn" : ""}`}>{formatDate(l.expires_on)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {s.set_up && !s.shares_decided && (
        <p className="banner warn small">
          {tr("Shares not yet decided.")} <Link href="/compliance/directors">{tr("Record your directors and, when you agree it, the shareholding →")}</Link>
        </p>
      )}

      <section className="card">
        <h2>{tr("Ask: what do I need?")}</h2>
        <form method="get" action="/compliance/guide" className="inline-form" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="search" name="q" placeholder={tr("e.g. supplying lubricants to a mine")} aria-label={tr("Question")} style={{ flex: "1 1 200px", minWidth: 0 }} />
          <button type="submit" className="btn">
            {tr("Show")}
          </button>
        </form>
      </section>

      <Disclaimer />
    </>
  );
}

