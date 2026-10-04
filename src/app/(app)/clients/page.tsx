import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { ListToolbar } from "@/components/ListToolbar";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { INDUSTRIES } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";

export const metadata = { title: "Clients" };

type Row = {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  region: string | null;
  currency: string;
  credit_limit: number;
  active: boolean;
};

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const industry = typeof sp.industry === "string" ? sp.industry : "";
  const archived = sp.archived === "1";
  const { supabase, company, role } = await getAppContext();

  let query = supabase
    .from("clients")
    .select("id, code, name, industry, region, currency, credit_limit, active", { count: "exact" })
    .eq("company_id", company.id)
    .order("name")
    .limit(LIST_LIMIT);
  if (!archived) query = query.eq("active", true);
  if (industry) query = query.eq("industry", industry);
  if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,region.ilike.%${q}%,tin.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  return (
    <>
      <div className="page-head">
        <h1>{tr("Clients")}</h1>
        <span className="muted small">{count ?? 0}{" "}{tr("found")}</span>
      </div>
      <Notice {...notice} />
      <ListToolbar
        q={q}
        archived={archived}
        filter={{ name: "industry", label: "Industries", value: industry, options: INDUSTRIES }}
        addHref={can(role, "editClients") ? "/clients/new" : undefined}
        addLabel="New client"
      />
      {rows.length === 0 ? (
        <p className="card muted">
          {q || industry ? tr("No clients match your search.") : tr("No clients yet.")}{" "}
          {can(role, "importData") && !q && !industry && (
            <>{tr("You can")}{" "}<Link href="/import">{tr("import them from your spreadsheet")}</Link>.
            </>
          )}
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`}>
                <div className="main">
                  <div className="title">
                    {c.name} {!c.active && <span className="badge off">{tr("Archived")}</span>}
                  </div>
                  <div className="sub">
                    {c.code}
                    {c.industry ? ` · ${c.industry}` : ""}
                    {c.region ? ` · ${c.region}` : ""}
                  </div>
                </div>
                <div className="side muted">
                  {c.credit_limit > 0 ? (
                    <>
                      <div className="small">{tr("Credit limit")}</div>
                      {formatMoney(c.credit_limit, "TZS")}
                    </>
                  ) : (
                    c.currency
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(count ?? 0) > LIST_LIMIT && (
        <p className="muted small">{tr("Showing the first")}{" "}{LIST_LIMIT}{tr(". Search to narrow the list.")}</p>
      )}
    </>
  );
}
