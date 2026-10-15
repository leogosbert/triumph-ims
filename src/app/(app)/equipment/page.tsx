import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { canPlanService } from "@/lib/services";
import { equipmentBadges } from "./badges";

export const metadata = { title: "Equipment" };

type Row = {
  id: string;
  client_id: string;
  name: string;
  serial_no: string | null;
  location: string | null;
  next_service_on: string | null;
  warranty_until: string | null;
  active: boolean;
  client: { name: string } | null;
};

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function EquipmentPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const client = pick(sp.client);
  const q = pick(sp.q).trim();
  const showAll = sp.view === "all";

  let query = supabase
    .from("client_equipment")
    .select("id, client_id, name, serial_no, location, next_service_on, warranty_until, active, client:clients(name)")
    .eq("company_id", company.id)
    .order("name")
    .limit(1000);
  if (!showAll) query = query.eq("active", true);
  if (/^[0-9a-f-]{36}$/i.test(client)) query = query.eq("client_id", client);
  // Characters that would break the PostgREST or() filter are dropped.
  const safe = q.replace(/[,()*%\\:"']/g, " ").trim();
  if (safe) query = query.or(`name.ilike.%${safe}%,serial_no.ilike.%${safe}%`);
  const { data, error } = await query;
  if (isMissingTable(error)) return <NotReady title="Equipment" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const clients = await clientOptions(supabase, company.id);

  // Grouped by client.
  const groups = new Map<string, { name: string; items: Row[] }>();
  for (const r of rows) {
    const g = groups.get(r.client_id) ?? { name: r.client?.name ?? "—", items: [] };
    g.items.push(r);
    groups.set(r.client_id, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const due = rows.filter((r) => equipmentBadges(r).some((b) => b.label === "Service due" || b.label === "Service overdue")).length;

  const link = (view: string) => {
    const p = new URLSearchParams();
    if (client) p.set("client", client);
    if (q) p.set("q", q);
    if (view) p.set("view", view);
    const s = p.toString();
    return s ? `/equipment?${s}` : "/equipment";
  };

  return (
    <>
      <div className="page-head">
        <h1>{tr("Equipment")}</h1>
        {canPlanService(role) && (
          <Link href={client ? `/equipment/new?client=${client}` : "/equipment/new"} className="btn btn-primary btn-small">
            {tr("+ Equipment")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Machines and systems you installed or look after at your clients, with their service dates and warranty.")}</p>
      <Notice {...notice} />
      <form method="get" action="/equipment" className="card">
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="client">{tr("Client")}</label>
            <select id="client" name="client" defaultValue={client}>
              <option value="">{tr("All clients")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="q">{tr("Search")}</label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder={tr("Name or serial number")} />
          </div>
        </div>
        {showAll && <input type="hidden" name="view" value="all" />}
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>
      {due > 0 && (
        <p className="banner small warn">
          {tr("Service due within 14 days:")} <strong>{due}</strong>
        </p>
      )}
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href={link("")} aria-current={!showAll ? "page" : undefined}>
          {tr("In use")}
        </Link>
        <Link href={link("all")} aria-current={showAll ? "page" : undefined}>
          {tr("All")}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">
          {client || q ? tr("No equipment matches.") : tr("No equipment yet. Record what you install at clients to be reminded of services and warranty.")}
        </p>
      ) : (
        sorted.map(([cid, g]) => (
          <section key={cid}>
            <h2 className="small" style={{ margin: "16px 0 6px" }}>
              <Link href={`/equipment?client=${cid}`}>{g.name}</Link> <span className="muted">· {g.items.length}</span>
            </h2>
            <ul className="rec-list">
              {g.items.map((e) => {
                const badges = equipmentBadges(e);
                return (
                  <li key={e.id}>
                    <Link href={`/equipment/${e.id}`}>
                      <div className="main">
                        <div className="title">{e.name}</div>
                        <div className="sub">
                          {[e.serial_no && `${tr("S/N")} ${e.serial_no}`, e.location, e.next_service_on && `${tr("Next service")} ${formatDate(e.next_service_on)}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <div className="side" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        {badges.map((b) => (
                          <span key={b.label} className={`badge tone-${b.tone}`}>
                            {tr(b.label)}
                          </span>
                        ))}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
