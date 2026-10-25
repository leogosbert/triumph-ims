import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { daysUntil, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { COMPLIANCE_CATEGORIES, requirement } from "@/lib/compliance/catalogue";
import { canSeeCompliance, ITEM_FIELDS, ITEM_STATUS, type ComplianceItem } from "@/lib/compliance/model";
import { StatusBadge } from "@/lib/sales";
import { ComplianceTabs, Disclaimer } from "../parts";

export const metadata = { title: "Compliance checklist" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ChecklistPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, isManager } = await getAppContext();
  if (!canSeeCompliance(role)) redirect("/");
  const show = pick(sp.show) ?? "all";

  const [{ data, error }, links] = await Promise.all([
    supabase.from("compliance_items").select(ITEM_FIELDS).eq("company_id", company.id).order("sort").order("name").limit(1000),
    supabase.from("compliance_documents").select("item_id").eq("company_id", company.id).not("item_id", "is", null).limit(5000),
  ]);
  if (isMissingTable(error)) return <NotReady title="Compliance checklist" />;
  if (error) throw new Error(error.message);
  const all = (data ?? []) as ComplianceItem[];
  const docs = new Map<string, number>();
  for (const l of (links.data ?? []) as { item_id: string }[]) docs.set(l.item_id, (docs.get(l.item_id) ?? 0) + 1);
  const needsCopy = (i: ComplianceItem) => {
    const k = requirement(i.code)?.kind;
    return i.status === "done" && (k === "registration" || k === "licence") && !docs.get(i.id);
  };
  const items = all.filter((i) =>
    show === "open" ? i.status === "not_started" || i.status === "in_progress" : show === "nocopy" ? needsCopy(i) : show === "na" ? i.status === "not_applicable" : i.status !== "not_applicable",
  );
  const counts = {
    all: all.filter((i) => i.status !== "not_applicable").length,
    open: all.filter((i) => i.status === "not_started" || i.status === "in_progress").length,
    nocopy: all.filter(needsCopy).length,
    na: all.filter((i) => i.status === "not_applicable").length,
  };
  const groups = COMPLIANCE_CATEGORIES.map((c) => ({ ...c, items: items.filter((i) => i.category === c.key) })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="page-head">
        <h1>{tr("Compliance checklist")}</h1>
        {isManager && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link href="/compliance/checklist/adopt" className="btn btn-primary btn-small">
              {all.length === 0 ? tr("Set up my checklist") : tr("+ From the catalogue")}
            </Link>
            <Link href="/compliance/checklist/new" className="btn btn-small">
              {tr("+ Own item")}
            </Link>
          </div>
        )}
        {!isManager && role === "finance" && (
          <Link href="/compliance/checklist/new" className="btn btn-small">
            {tr("+ Tax item")}
          </Link>
        )}
      </div>
      <ComplianceTabs current="/compliance/checklist" />
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        {(
          [
            ["all", "All"],
            ["open", "To do"],
            ["nocopy", "No copy uploaded"],
            ["na", "Does not apply"],
          ] as const
        ).map(([k, label]) => (
          <Link key={k} href={`/compliance/checklist?show=${k}`} aria-current={show === k ? "page" : undefined}>
            {tr(label)} ({counts[k]})
          </Link>
        ))}
      </nav>

      {all.length === 0 ? (
        <section className="card">
          <p>{tr("Your checklist is empty.")}</p>
          {isManager ? (
            <Link href="/compliance/checklist/adopt" className="btn btn-primary">
              {tr("Set up my checklist")}
            </Link>
          ) : (
            <p className="muted small">{tr("Ask management to set up the checklist.")}</p>
          )}
        </section>
      ) : groups.length === 0 ? (
        <p className="card muted">{tr("Nothing here.")}</p>
      ) : (
        groups.map((g) => {
          const doneN = g.items.filter((i) => i.status === "done").length;
          return (
            <section key={g.key} className="card">
              <div className="line-head" style={{ alignItems: "baseline" }}>
                <h2 style={{ margin: 0 }}>{tr(g.label)}</h2>
                <span className="small muted">
                  {doneN}/{g.items.length} {tr("done")}
                </span>
              </div>
              <ul className="rec-list" style={{ marginTop: 8 }}>
                {g.items.map((i) => {
                  const left = i.status === "done" || i.status === "not_applicable" ? null : daysUntil(i.due_on);
                  const n = docs.get(i.id) ?? 0;
                  return (
                    <li key={i.id}>
                      <Link href={`/compliance/checklist/${i.id}`}>
                        <div className="main">
                          <div className="title">
                            {n > 0 ? "📎 " : ""}
                            {tr(i.name)}
                          </div>
                          <div className="sub">
                            {i.authority ? tr(i.authority) : tr("Own item")}
                            {i.due_on && left !== null && ` · ${tr("due")} ${formatDate(i.due_on)}`}
                            {i.status_note && ` · ${i.status_note}`}
                          </div>
                        </div>
                        <div className="side" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          <StatusBadge map={ITEM_STATUS} status={i.status} />
                          {left !== null && left < 0 && <span className="badge tone-bad">{tr("Overdue")}</span>}
                          {needsCopy(i) && <span className="badge tone-warn">{tr("Upload the copy")}</span>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      <Disclaimer compact />
    </>
  );
}
