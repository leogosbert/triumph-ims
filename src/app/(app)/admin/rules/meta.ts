/** The numbers company_metrics() measures for every company (Stage 11 contract). */
export const METRICS: { key: string; label: string }[] = [
  { key: "members", label: "Team members" },
  { key: "clients", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "products", label: "Products" },
  { key: "warehouses", label: "Active stores" },
  { key: "invoices_30d", label: "Invoices issued (last 30 days)" },
  { key: "quotations_30d", label: "Quotations (last 30 days)" },
  { key: "purchase_orders_30d", label: "Purchase orders (last 30 days)" },
  { key: "deliveries_30d", label: "Deliveries (last 30 days)" },
  { key: "revenue_30d", label: "Sales in TZS (last 30 days)" },
  { key: "receivables_open", label: "Money owed by customers (TZS)" },
  { key: "credit_clients", label: "Customers buying on credit" },
  { key: "foreign_docs_90d", label: "Documents in another currency (last 90 days)" },
  { key: "suggestions_30d", label: "Suggestions (last 30 days)" },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);

export function metricLabel(key: string) {
  return METRICS.find((m) => m.key === key)?.label ?? key;
}

export const OPS = [">=", ">", "<=", "<"];

export const OP_LABEL: Record<string, string> = {
  ">=": "reaches",
  ">": "is above",
  "<=": "is at most",
  "<": "is below",
};
