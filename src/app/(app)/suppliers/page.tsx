import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListToolbar } from "@/components/ListToolbar";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { CURRENCIES } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";

export const metadata = { title: "Suppliers" };

type Row = {
  id: string;
  code: string;
  name: string;
  country: string | null;
  city: string | null;
  brands: string | null;
  currency: string;
  lead_time_days: number | null;
  active: boolean;
};

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const currency = typeof sp.currency === "string" ? sp.currency : "";
  const archived = sp.archived === "1";
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeSuppliers")) redirect("/");

  let query = supabase
    .from("suppliers")
    .select("id, code, name, country, city, brands, currency, lead_time_days, active", { count: "exact" })
    .eq("company_id", company.id)
    .order("name")
    .limit(LIST_LIMIT);
  if (!archived) query = query.eq("active", true);
  if (currency) query = query.eq("currency", currency);
  if (q)
    query = query.or(
      `name.ilike.%${q}%,code.ilike.%${q}%,brands.ilike.%${q}%,products_supplied.ilike.%${q}%,country.ilike.%${q}%`,
    );
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  return (
    <>
      <div className="page-head">
        <h1>{tr("Suppliers")}</h1>
        <span className="muted small">{count ?? 0}{" "}{tr("found")}</span>
      </div>
      <Notice {...notice} />
      <ListToolbar
        q={q}
        archived={archived}
        filter={{ name: "currency", label: "Currencies", value: currency, options: CURRENCIES }}
        addHref={can(role, "editSuppliers") ? "/suppliers/new" : undefined}
        addLabel="New supplier"
      />
      {rows.length === 0 ? (
        <p className="card muted">{q || currency ? tr("No suppliers match your search.") : tr("No suppliers yet.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/suppliers/${s.id}`}>
                <div className="main">
                  <div className="title">
                    {s.name} {!s.active && <span className="badge off">{tr("Archived")}</span>}
                  </div>
                  <div className="sub">
                    {s.code}
                    {s.city || s.country ? ` · ${[s.city, s.country].filter(Boolean).join(", ")}` : ""}
                    {s.brands ? ` · ${s.brands}` : ""}
                  </div>
                </div>
                <div className="side muted">
                  {s.currency}
                  {s.lead_time_days !== null && <div className="small">{s.lead_time_days}{" "}{tr("days")}</div>}
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
