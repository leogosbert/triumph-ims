import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { ENQUIRY_STATUS } from "@/lib/growth-tools/catalogue";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";

export const metadata = { title: "Catalogue requests" };

type Row = { id: string; kind: string; name: string; company_name: string | null; status: string; lines: unknown[]; created_at: string; message: string | null };

export default async function EnquiriesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features, isManager } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  if (!features.on("online_catalogue")) return <FeatureOff title="Online catalogue" isManager={isManager} />;
  const view = sp.view === "all" ? "all" : "new";
  let query = supabase.from("catalogue_enquiries").select("id, kind, name, company_name, status, lines, created_at, message").eq("company_id", company.id).order("created_at", { ascending: false }).limit(300);
  if (view === "new") query = query.eq("status", "new");
  const { data, error } = await query;
  if (isMissingTable(error)) return <NotReady title="Catalogue requests" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  return (
    <>
      <p className="small">
        <Link href="/catalogue">{tr("← Online catalogue")}</Link>
      </p>
      <h1>{tr("Catalogue requests")}</h1>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/catalogue/enquiries" aria-current={view === "new" ? "page" : undefined}>
          {tr("New")}
        </Link>
        <Link href="/catalogue/enquiries?view=all" aria-current={view === "all" ? "page" : undefined}>
          {tr("All")}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No requests yet. Share the catalogue link so buyers can ask for quotations.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((e) => (
            <li key={e.id}>
              <Link href={`/catalogue/enquiries/${e.id}`}>
                <div className="main">
                  <div className="title">
                    {e.name}
                    {e.company_name && ` · ${e.company_name}`}
                  </div>
                  <div className="sub">
                    {e.kind === "quote" ? tr("Request for quotation") : tr("Enquiry")}
                    {Array.isArray(e.lines) && e.lines.length > 0 && ` · ${e.lines.length} ${tr("products")}`}
                    {" · "}
                    {formatDateTime(e.created_at)}
                  </div>
                  {e.message && <div className="sub">{e.message.slice(0, 120)}</div>}
                </div>
                <div className="side">
                  <StatusBadge map={ENQUIRY_STATUS} status={e.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
