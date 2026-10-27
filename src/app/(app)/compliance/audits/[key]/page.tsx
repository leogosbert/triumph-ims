import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { PrintButton } from "@/components/reports/PrintButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { auditPack, checkPack, LINE_STATE } from "@/lib/compliance/audits";
import { requirement } from "@/lib/compliance/catalogue";
import { canSeeCompliance } from "@/lib/compliance/model";
import { legalRules } from "@/lib/compliance/rules";
import { todayTz } from "@/lib/services";
import { adoptPack, markNotNeeded } from "../../actions";
import { Disclaimer } from "../../parts";
import { loadPackData } from "../data";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Inspection pack" };

export default async function AuditPackPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { key } = await params;
  const notice = await readNotice(searchParams);
  const pack = auditPack(key);
  if (!pack) notFound();
  const { supabase, company, roles, isManager } = await getAppContext();
  if (!canSeeCompliance(roles)) redirect("/");
  const today = todayTz();
  const d = await loadPackData(supabase, company.id, today, roles);
  if ("missing" in d) {
    if (isMissingTable(d.error as { code?: string; message?: string })) return <NotReady title="Inspection pack" />;
    throw new Error(String((d.error as { message?: string })?.message ?? "error"));
  }
  const { data: set } = await supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle();
  const rules = legalRules(set?.legal_rules);
  const c = checkPack(pack, d);
  const back = `/compliance/audits/${pack.key}`;
  const notAdded = c.lines.filter((l) => l.code && !d.items.has(l.code)).map((l) => l.code as string);

  return (
    <>
      <BackLink href="/compliance/audits" label="Inspections & audits" />
      <Notice {...notice} />
      <div className="report-print">
        <div className="page-head">
          <h1 style={{ margin: 0 }}>{tr(pack.title)}</h1>
          <span className={`badge tone-${c.pct >= 80 ? "ok" : c.pct >= 50 ? "warn" : "bad"}`}>
            {c.pct}% {tr("ready")}
          </span>
        </div>
        <p className="small muted">
          {company.legal_name || company.name}
          {company.tin && ` · TIN ${company.tin}`} · {tr(pack.who)} · {tr("checked")} {formatDate(today)}
        </p>
        <p className="card small">{tr(pack.tip)}</p>

        <section className="card">
          <ul className="lines">
            {c.lines.map((l) => {
              const req = l.code ? requirement(l.code) : undefined;
              return (
                <li key={l.code ?? l.title}>
                  <div className="line-head" style={{ alignItems: "flex-start" }}>
                    <span>
                      <Link href={l.href} className="desc">
                        {tr(l.title)}
                      </Link>
                      <br />
                      <span className="small muted">
                        {l.authority && `${tr(l.authority)} · `}
                        {tr(l.detail)}
                      </span>
                      {req && l.state !== "ok" && l.state !== "na" && (
                        <details className="no-print small" style={{ marginTop: 2 }}>
                          <summary>{tr("Documents usually needed")}</summary>
                          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                            {req.documentsNeeded.map((x) => (
                              <li key={x}>{tr(x)}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </span>
                    <span className={`badge tone-${LINE_STATE[l.state].tone}`}>{tr(LINE_STATE[l.state].label)}</span>
                  </div>
                  {isManager && l.code && l.state === "missing" && (
                    <form action={markNotNeeded} className="no-print" style={{ marginTop: 4 }}>
                      <input type="hidden" name="code" value={l.code} />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton className="btn btn-small" pendingText="…">
                        {tr("Not needed for us")}
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <p className="small muted">
          {tr("Keep books, receipts and returns for")} {rules.records_years} {tr("years")}.
          {pack.key === "pdpc" && rules.dpo_name && ` ${tr("Person responsible for personal data")}: ${rules.dpo_name}.`}
          {pack.key === "pdpc" && ` ${tr("Report a data breach to the PDPC within")} ${rules.breach_hours} ${tr("hours")}.`}
        </p>
      </div>

      <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <PrintButton />
        {isManager && notAdded.length > 0 && (
          <form action={adoptPack}>
            <input type="hidden" name="back" value={back} />
            {notAdded.map((code) => (
              <input key={code} type="hidden" name="code" value={code} />
            ))}
            <SubmitButton className="btn btn-small btn-primary">
              {tr("Add the missing ones to my checklist")} ({notAdded.length})
            </SubmitButton>
          </form>
        )}
      </div>
      <Disclaimer compact />
    </>
  );
}
