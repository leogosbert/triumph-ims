import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { isMissingSql } from "@/components/suggestions/meta";
import { BILLING_MISSING } from "@/lib/billing";
import { readNotice, type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../../guard";
import { RequestCard, type AdminRequest } from "../RequestCard";

export const metadata = { title: "Requests" };

const FILTERS: [string, string][] = [
  ["requested", "Waiting"],
  ["approved", "Approved"],
  ["delivered", "Done"],
  ["declined", "Declined"],
  ["", "All"],
];

/** Requests from companies for services, add-ons and playbooks. Waiting ones first. */
export default async function AdminRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const status = typeof sp.s === "string" ? sp.s : "requested";
  const { data, error } = await admin.supabase.rpc("platform_service_requests", { p_status: status || null });
  const rows = (data ?? []) as AdminRequest[];
  const back = `/admin/billing/requests${status !== "requested" ? `?s=${status}` : ""}`;

  return (
    <>
      <Notice {...notice} />
      <div className="adm-subtabs" aria-label={tr("Filter")}>
        {FILTERS.map(([v, label]) => (
          <Link key={v || "all"} href={`/admin/billing/requests${v === "requested" ? "" : `?s=${v}`}`} aria-current={status === v ? "page" : undefined}>
            {tr(label)}
          </Link>
        ))}
      </div>
      <section className="card">
        <h2>{tr("Requests from companies")}</h2>
        <p className="muted small">
          {tr("Approve to give a playbook or confirm a service; add-ons switch their features on at once. The company is told in the app. Approved services wait for the next invoice.")}
        </p>
        {error ? (
          <p className="notice notice-error">{isMissingSql(error) ? tr(BILLING_MISSING) : tr("Could not load requests.")}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{tr("Nothing here.")}</p>
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <RequestCard key={r.id} r={r} back={back} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
