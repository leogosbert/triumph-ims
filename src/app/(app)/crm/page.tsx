import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { OPEN_STAGES, OPP_STAGES, daysUntil, isMissingTable, stageLabel } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";

export const metadata = { title: "Pipeline" };

type Opp = {
  id: string;
  number: string;
  title: string;
  client_id: string | null;
  prospect_name: string | null;
  stage: string;
  value: number;
  currency: string;
  probability: number;
  expected_close: string | null;
  owner_id: string | null;
  next_action: string | null;
  next_on: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  client: { name: string } | null;
};

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  const who = sp.who === "all" || (sp.who !== "mine" && role === "management") ? "all" : "mine";
  const view = sp.view === "closed" ? "closed" : "open";
  const base = company.base_currency;

  let q = supabase
    .from("opportunities")
    .select("id, number, title, client_id, prospect_name, stage, value, currency, probability, expected_close, owner_id, next_action, next_on, closed_at, lost_reason, client:clients(name)")
    .eq("company_id", company.id)
    .order("expected_close", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (who === "mine") q = q.eq("owner_id", user.id);
  if (view === "open") q = q.in("stage", OPEN_STAGES);
  else q = q.in("stage", ["won", "lost"]).gte("closed_at", new Date(Date.now() - 180 * 86_400_000).toISOString());
  const { data, error } = await q;
  if (isMissingTable(error)) return <NotReady title="Pipeline" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Opp[];
  const names = await namesFor(supabase, rows.map((r) => r.owner_id));
  const party = (o: Opp) => o.client?.name ?? o.prospect_name ?? "";

  const inBase = rows.filter((r) => r.currency === base);
  const open = inBase.filter((r) => OPEN_STAGES.includes(r.stage as never));
  const pipeline = open.reduce((s, r) => s + Number(r.value), 0);
  const weighted = open.reduce((s, r) => s + (Number(r.value) * r.probability) / 100, 0);
  const due = rows.filter((r) => OPEN_STAGES.includes(r.stage as never) && r.next_on && (daysUntil(r.next_on) ?? 1) <= 0);
  const won = rows.filter((r) => r.stage === "won");
  const lost = rows.filter((r) => r.stage === "lost");
  const href = (o: { who?: string; view?: string }) => `/crm?who=${o.who ?? who}&view=${o.view ?? view}`;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Pipeline")}</h1>
        <Link href="/crm/new" className="btn btn-primary btn-small">
          {tr("+ Opportunity")}
        </Link>
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href={href({ who: "mine" })} aria-current={who === "mine" ? "page" : undefined}>
          {tr("Mine")}
        </Link>
        <Link href={href({ who: "all" })} aria-current={who === "all" ? "page" : undefined}>
          {tr("Everyone")}
        </Link>
        <span style={{ width: 12 }} />
        <Link href={href({ view: "open" })} aria-current={view === "open" ? "page" : undefined}>
          {tr("Open")}
        </Link>
        <Link href={href({ view: "closed" })} aria-current={view === "closed" ? "page" : undefined}>
          {tr("Won & lost")}
        </Link>
        <Link href="/tenders">{tr("Tenders")}</Link>
        <Link href="/contracts">{tr("Contracts")}</Link>
      </nav>

      {view === "open" ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="n">{formatMoney(pipeline, base)}</div>
              <div className="l">{tr("Open pipeline")}</div>
            </div>
            <div className="stat">
              <div className="n">{formatMoney(weighted, base)}</div>
              <div className="l">{tr("Likely (by stage chance)")}</div>
            </div>
            <div className="stat">
              <div className="n">{rows.length}</div>
              <div className="l">{tr("Open opportunities")}</div>
            </div>
            <div className="stat">
              <div className={`n${due.length ? " text-warn" : ""}`}>{due.length}</div>
              <div className="l">{tr("Follow-ups due")}</div>
            </div>
          </div>

          {due.length > 0 && (
            <section className="card">
              <h2>{tr("Follow up today")}</h2>
              <ul className="list">
                {due.map((o) => (
                  <li key={o.id} className="row">
                    <Link href={`/crm/${o.id}`}>
                      {party(o)} · {o.next_action ?? o.title}
                    </Link>
                    <span className={`small${(daysUntil(o.next_on) ?? 0) < 0 ? " text-warn" : ""}`}>{formatDate(o.next_on!)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {rows.length === 0 ? (
            <p className="card muted">{tr("No open opportunities. Add one with “+ Opportunity” whenever a client or prospect shows interest.")}</p>
          ) : (
            <div className="board">
              {OPP_STAGES.filter((s) => OPEN_STAGES.includes(s.key)).map((s) => {
                const col = rows.filter((r) => r.stage === s.key);
                const sum = col.filter((r) => r.currency === base).reduce((a, r) => a + Number(r.value), 0);
                return (
                  <section key={s.key} className="board-col" aria-label={tr(s.label)}>
                    <h3>
                      <span>{tr(s.label)}</span>
                      <span className="muted">{col.length}</span>
                    </h3>
                    <div className="col-sum">{formatMoney(sum, base)}</div>
                    {col.map((o) => (
                      <Link key={o.id} href={`/crm/${o.id}`} className="board-card">
                        <div className="t">{party(o)}</div>
                        <div className="s">{o.title}</div>
                        <div className="s">
                          {formatMoney(o.value, o.currency)}
                          {o.expected_close && ` · ${formatDate(o.expected_close)}`}
                          {who === "all" && o.owner_id && names.get(o.owner_id) && ` · ${names.get(o.owner_id)}`}
                        </div>
                        {o.next_on && (
                          <div className={`s${(daysUntil(o.next_on) ?? 1) <= 0 ? " text-warn" : ""}`}>
                            → {o.next_action ?? tr("Next step")} · {formatDate(o.next_on)}
                          </div>
                        )}
                      </Link>
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="n text-ok">{won.length}</div>
              <div className="l">{tr("Won (last 6 months)")}</div>
            </div>
            <div className="stat">
              <div className="n">{lost.length}</div>
              <div className="l">{tr("Lost (last 6 months)")}</div>
            </div>
            <div className="stat">
              <div className="n">{won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0}%</div>
              <div className="l">{tr("Win rate")}</div>
            </div>
            <div className="stat">
              <div className="n">{formatMoney(won.filter((r) => r.currency === base).reduce((s, r) => s + Number(r.value), 0), base)}</div>
              <div className="l">{tr("Value won")}</div>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="card muted">{tr("Nothing won or lost in the last 6 months.")}</p>
          ) : (
            <ul className="rec-list">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link href={`/crm/${o.id}`}>
                    <div className="main">
                      <div className="title">{party(o)}</div>
                      <div className="sub">
                        {o.title} · {o.closed_at ? formatDate(o.closed_at) : ""}
                        {o.lost_reason && ` · ${o.lost_reason}`}
                      </div>
                    </div>
                    <div className="side">
                      <div>{formatMoney(o.value, o.currency)}</div>
                      <div className={`small ${o.stage === "won" ? "text-ok" : "muted"}`}>{tr(stageLabel(o.stage))}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
