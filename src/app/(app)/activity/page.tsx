import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { displayName, requireManager, type Profile } from "@/lib/context";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Activity" };

type LogRow = {
  id: number;
  actor_id: string | null;
  action: "insert" | "update" | "delete";
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const ENTITY: Record<string, string> = {
  companies: "company details",
  memberships: "team member",
  invitations: "invitation",
  clients: "client",
  client_contacts: "client contact",
  suppliers: "supplier",
  products: "product",
  product_costs: "product cost",
  rfqs: "RFQ",
  rfq_lines: "RFQ item",
  quotations: "quotation",
  quotation_lines: "quotation line",
  supplier_rfqs: "supplier RFQ",
  supplier_rfq_suppliers: "supplier on an RFQ",
  purchase_orders: "purchase order",
  po_lines: "PO line",
  warehouses: "store",
  goods_receipts: "goods received note",
  deliveries: "delivery note",
  delivery_lines: "delivery line",
  invoices: "invoice",
  invoice_lines: "invoice line",
  payments: "payment received",
  supplier_bills: "supplier bill",
  supplier_payments: "payment to supplier",
  order_costs: "order cost",
  exchange_rates: "exchange rate",
};

const LINKS: Record<string, string> = {
  clients: "/clients/",
  suppliers: "/suppliers/",
  products: "/products/",
  rfqs: "/rfqs/",
  quotations: "/quotations/",
  supplier_rfqs: "/supplier-rfqs/",
  purchase_orders: "/purchase-orders/",
  goods_receipts: "/grns/",
  deliveries: "/deliveries/",
  invoices: "/invoices/",
  supplier_bills: "/bills/",
};

const FIELD: Record<string, string> = {
  name: "name",
  legal_name: "registered name",
  tin: "TIN",
  vrn: "VRN",
  registration_no: "registration number",
  address: "address",
  phone: "phone",
  email: "email",
  website: "website",
  base_currency: "main currency",
  second_currency: "second currency",
  primary_color: "main colour",
  accent_color: "dark colour",
  logo_path: "logo",
  bank_details: "bank details",
  document_footer: "footer text",
  role: "role",
  active: "access",
  revoked_at: "cancelled",
  accepted_at: "accepted",
  accepted_by: "accepted by",
  code: "ID",
  sku: "SKU",
  industry: "industry",
  credit_limit: "credit limit",
  payment_terms: "payment terms",
  currency: "currency",
  selling_price: "selling price",
  last_cost: "last cost",
  main_supplier_id: "main supplier",
  lead_time_days: "lead time (days)",
  status: "status",
  quantity: "quantity",
  unit_price: "unit price",
  discount_pct: "discount %",
  total: "total",
  approval_reason: "approval reason",
  review_note: "manager's note",
  driver_id: "driver",
  vehicle: "vehicle",
  received_by_name: "received by",
  failed_reason: "reason for failure",
  delivery_site: "delivery site",
  planned_date: "planned date",
  amount_paid: "amount paid",
  due_date: "due date",
  voided_at: "voided",
  void_reason: "reason voided",
  cancelled_reason: "reason cancelled",
};

const HIDDEN_FIELDS = new Set(["subtotal", "discount_total", "vat_amount", "line_total", "submitted_at", "approved_at", "sent_at", "decided_at", "submitted_by", "approved_by"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (v === true) return "yes";
  if (v === false) return "no";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function describe(row: LogRow): { title: string; changes: string[] } {
  const thing = ENTITY[row.entity] ?? row.entity;
  const d = row.details ?? {};
  if (row.entity === "invitations" && row.action === "insert") {
    return { title: `Invited ${show(d.email)} as ${show(d.role)}`, changes: [] };
  }
  if (row.entity === "memberships" && row.action === "insert") {
    return { title: `New team member joined as ${show(d.role)}`, changes: [] };
  }
  if (row.entity === "companies" && row.action === "insert") {
    return { title: `Created the company ${show(d.name)}`, changes: [] };
  }
  if (row.action === "update") {
    const changes = Object.entries(d).filter(([k]) => !HIDDEN_FIELDS.has(k)).map(([k, v]) => {
      const c = v as { from?: unknown; to?: unknown };
      const label = FIELD[k] ?? k;
      if (k === "logo_path" || k === "accepted_by" || k === "main_supplier_id") return `${label} changed`;
      return `${label}: ${show(c.from)} → ${show(c.to)}`;
    });
    return { title: `Changed ${thing}`, changes };
  }
  const label =
    typeof d.name === "string" ? ` ${d.name}` : typeof d.number === "string" ? ` ${d.number}` : typeof d.description === "string" ? `: ${d.description}` : "";
  return { title: `${row.action === "delete" ? "Removed" : "Added"} ${thing}${label}`, changes: [] };
}

export default async function ActivityPage() {
  await primeLang();
  const { supabase, company } = await requireManager();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_id, action, entity, entity_id, details, created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as LogRow[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: people } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", actorIds)
    : { data: [] };
  const names = new Map(((people ?? []) as Profile[]).map((p) => [p.id, displayName(p)]));

  return (
    <>
      <h1>{tr("Activity")}</h1>
      <p className="muted">{tr("Every change to settings, the team, clients, suppliers and products, newest first. This record cannot be edited.")}</p>
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">{tr("Nothing recorded yet.")}</p>
        ) : (
          <ul className="list">
            {rows.map((r) => {
              const { title, changes } = describe(r);
              return (
                <li key={r.id} className="log-item">
                  <div className="what">
                    {LINKS[r.entity] && r.entity_id ? <Link href={`${LINKS[r.entity]}${r.entity_id}`}>{title}</Link> : title}
                  </div>
                  <div className="muted small">
                    {r.actor_id ? names.get(r.actor_id) ?? tr("Former team member") : tr("System")} ·{" "}
                    {formatDateTime(r.created_at)}
                  </div>
                  {changes.length > 0 && (
                    <ul className="changes">
                      {changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
