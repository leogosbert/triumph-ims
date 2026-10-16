import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CorrectiveActions } from "@/components/CorrectiveActions";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { NCR_DISPOSITIONS, NCR_SOURCES, NCR_STATUS, withCurrent, type Ncr } from "@/lib/hse";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { formatWhen, todayTz } from "@/lib/services";
import { setRecordStatus } from "../../hse/actions";
import { saveNcr } from "../actions";
import { NcrFields } from "../NcrFields";
import { loadNcrOptions, ncrLinkedNames } from "../options";

export const metadata = { title: "NCR" };

function StatusButton({ id, status, label, primary = false }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setRecordStatus}>
      <input type="hidden" name="kind" value="ncr" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={`btn btn-small${primary ? " btn-primary" : ""}`}>{tr(label)}</SubmitButton>
    </form>
  );
}

export default async function NcrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "seeQuality")) redirect("/");
  const { data, error } = await supabase.from("quality_ncrs").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="NCR" />;
  if (!data) notFound();
  const ncr = data as Ncr;
  const manager = role === "management";
  const editor = manager || (ncr.raised_by === user.id && ncr.status !== "closed");
  const [linked, names, options] = await Promise.all([
    ncrLinkedNames(supabase, ncr),
    namesFor(supabase, [ncr.raised_by, ncr.closed_by]),
    editor ? loadNcrOptions(supabase, company.id) : Promise.resolve(null),
  ]);
  const base = company.base_currency;
  const links = [
    { href: `/suppliers/${ncr.supplier_id}`, label: "Supplier", name: ncr.supplier_id ? linked.supplier : null },
    { href: `/purchase-orders/${ncr.purchase_order_id}`, label: "Purchase order", name: ncr.purchase_order_id ? linked.order : null },
    { href: `/clients/${ncr.client_id}`, label: "Client", name: ncr.client_id ? linked.client : null },
    { href: `/deliveries/${ncr.delivery_id}`, label: "Delivery", name: ncr.delivery_id ? linked.delivery : null },
    { href: `/products/${ncr.product_id}`, label: "Product", name: ncr.product_id ? linked.product : null },
  ];

  return (
    <>
      <p className="small">
        <Link href="/quality">{tr("← Quality")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{ncr.title}</h1>
        <StatusBadge map={NCR_STATUS} status={ncr.status} />
      </div>
      <p className="muted small">
        {ncr.number} · {tr(NCR_SOURCES[ncr.source] ?? ncr.source)} · {formatDate(ncr.raised_on)} · {tr("raised by")} {names.get(ncr.raised_by) ?? "—"}
      </p>
      <Notice {...notice} />

      {manager && (
        <div className="actions-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {ncr.status === "open" && <StatusButton id={ncr.id} status="action" label="Actions in progress" primary />}
          {ncr.status !== "closed" && <StatusButton id={ncr.id} status="closed" label="Close" />}
          {ncr.status === "closed" && <StatusButton id={ncr.id} status="open" label="Reopen" />}
        </div>
      )}

      <section className="card">
        <p style={{ whiteSpace: "pre-wrap" }}>{ncr.description}</p>
        {links
          .filter((l) => l.name)
          .map((l) => (
            <p key={l.label} className="small">
              <strong>{tr(l.label)}:</strong> <Link href={l.href}>{l.name}</Link>
            </p>
          ))}
        {ncr.quantity_affected != null && (
          <p className="small">
            <strong>{tr("Quantity affected")}:</strong> {Number(ncr.quantity_affected).toLocaleString("en-GB")}
          </p>
        )}
        <p className="small">
          <strong>{tr("What to do with it")}:</strong> {ncr.disposition ? tr(NCR_DISPOSITIONS[ncr.disposition] ?? ncr.disposition) : tr("Not decided")}
        </p>
        {ncr.root_cause && (
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>
            <strong>{tr("Root cause")}:</strong> {ncr.root_cause}
          </p>
        )}
        <p className="small">
          <strong>{tr("Cost")}:</strong> {formatMoney(Number(ncr.cost ?? 0), base)}
        </p>
        {ncr.closed_at && (
          <p className="muted small">
            {tr("Closed")} {formatWhen(ncr.closed_at)}
            {ncr.closed_by && ` · ${names.get(ncr.closed_by) ?? ""}`}
          </p>
        )}
      </section>

      <CorrectiveActions sourceKind="ncr" sourceId={ncr.id} closed={ncr.status === "closed"} />

      {editor && options && (
        <details className="card">
          <summary>{tr("Change details")}</summary>
          <form action={saveNcr} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={ncr.id} />
            <NcrFields
              v={ncr}
              base={base}
              today={todayTz()}
              editing
              options={{
                suppliers: withCurrent(options.suppliers, ncr.supplier_id, linked.supplier),
                clients: withCurrent(options.clients, ncr.client_id, linked.client),
                products: withCurrent(options.products, ncr.product_id, linked.product),
                orders: withCurrent(options.orders, ncr.purchase_order_id, linked.order),
                deliveries: withCurrent(options.deliveries, ncr.delivery_id, linked.delivery),
              }}
            />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
