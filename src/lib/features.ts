import type { createClient } from "@/lib/supabase/server";
import type { Level } from "@/lib/levels";

/**
 * Feature switches ("Start Simple, Grow With Your Business").
 * The company's business level sets the default; managers (or LeMo admins) can switch single
 * features on or off. The database function company_feature_map is the source of truth.
 * Before the Stage 11 database update is run, the RPC fails: then ready=false and every
 * screen behaves exactly as before (everything that exists today stays visible).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type TutorialStep = { title: string; body: string };

export type FeatureRow = {
  key: string;
  name: string;
  description: string | null;
  module: string;
  default_level: Level;
  status: "live" | "planned";
  audience: string | null;
  benefits: string | null;
  tutorial: TutorialStep[];
  route: string | null;
  sort: number;
  enabled: boolean;
  /** 'level' (level default), 'manual', 'admin' or 'recommendation'. */
  source: string;
};

export type Features = {
  list: FeatureRow[];
  enabled: Set<string>;
  ready: boolean;
  /** True when the feature is on — or unknown, or the Stage 11 update has not been run yet. */
  on: (key?: string | null) => boolean;
};

/** Which feature each screen belongs to (used to hide menu items for switched-off features). */
export const ROUTE_FEATURES: Record<string, string> = {
  "/rfqs": "client_rfqs",
  "/quotations": "quotations",
  "/clients": "customers",
  "/products": "products",
  "/stock": "inventory",
  "/suppliers": "suppliers",
  "/purchase-orders": "purchases",
  "/supplier-rfqs": "supplier_rfqs",
  "/receiving": "goods_received",
  "/grns": "goods_received",
  "/invoices": "invoices",
  "/payments": "payments",
  "/receivables": "receivables",
  "/bills": "supplier_bills",
  "/payables": "payables",
  "/warehouses": "multi_warehouse",
  "/rates": "multi_currency",
  "/profit": "profit_analysis",
  "/deliveries": "deliveries",
  "/driver": "driver_app",
  "/notifications": "notifications",
  "/suggestions": "suggestions",
  "/activity": "activity",
  "/settings/team": "team",
  "/settings/export": "data_export",
  "/settings/backups": "data_export",
  "/settings/security": "security_policy",
  "/expenses": "expenses",
  "/profit-loss": "simple_pl",
  "/statements": "statements",
  "/reconcile": "mobile_money",
  "/crm": "crm_pipeline",
  "/tenders": "tenders",
  "/contracts": "contracts",
  "/documents": "documents",
};

/** The feature a link belongs to: longest matching route prefix ("/rfqs/new" → client_rfqs). */
export function featureForRoute(href: string): string | undefined {
  const path = href.split(/[?#]/)[0];
  let best: string | undefined;
  let bestLen = 0;
  for (const [route, key] of Object.entries(ROUTE_FEATURES)) {
    if ((path === route || path.startsWith(`${route}/`)) && route.length > bestLen) {
      best = key;
      bestLen = route.length;
    }
  }
  return best;
}

function makeOn(ready: boolean, known: Set<string>, enabled: Set<string>) {
  return (key?: string | null) => !key || !ready || CORE_FEATURES.has(key) || !known.has(key) || enabled.has(key);
}

/** Everything stays visible: what screens use before the Stage 11 SQL has been run. */
export function fallbackFeatures(): Features {
  return { list: [], enabled: new Set(), ready: false, on: () => true };
}

function toSteps(v: unknown): TutorialStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
    .filter((s): s is Record<string, unknown> => s !== null)
    .map((s) => ({ title: String(s.title ?? ""), body: String(s.body ?? "") }))
    .filter((s) => s.title || s.body);
}

export async function loadFeatures(supabase: Supabase, companyId: string): Promise<Features> {
  try {
    const { data, error } = await supabase.rpc("company_feature_map", { p_company: companyId });
    if (error || !Array.isArray(data)) return fallbackFeatures();
    const list: FeatureRow[] = (data as Record<string, unknown>[])
      .map((r) => ({
        key: String(r.key),
        name: String(r.name ?? r.key),
        description: (r.description as string | null) ?? null,
        module: String(r.module ?? "Other"),
        default_level: (r.default_level as Level) ?? "small",
        status: r.status === "planned" ? ("planned" as const) : ("live" as const),
        audience: (r.audience as string | null) ?? null,
        benefits: (r.benefits as string | null) ?? null,
        tutorial: toSteps(r.tutorial),
        route: (r.route as string | null) ?? null,
        sort: Number(r.sort ?? 0),
        enabled: Boolean(r.enabled),
        source: String(r.source ?? "level"),
      }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    // An empty catalogue means the seed is missing: behave as before rather than hide everything.
    if (list.length === 0) return fallbackFeatures();
    const enabled = new Set(list.filter((f) => f.enabled).map((f) => f.key));
    const known = new Set(list.map((f) => f.key));
    return { list, enabled, ready: true, on: makeOn(true, known, enabled) };
  } catch {
    return fallbackFeatures();
  }
}

/** Plain-language label for where a feature's on/off state comes from. */
export function sourceLabel(f: Pick<FeatureRow, "source" | "enabled" | "status">): string {
  if (f.status === "planned") return "Coming soon";
  switch (f.source) {
    case "manual":
      return f.enabled ? "Switched on manually" : "Switched off manually";
    case "admin":
      return "Set by LeMo admin";
    case "recommendation":
      return "Switched on from a recommendation";
    default:
      return "Level default";
  }
}

/** Features that are always part of the app and are not offered as a switch. */
export const CORE_FEATURES = new Set(["dashboard", "team", "security_policy", "data_export", "notifications", "activity", "suggestions"]);

export type Recommendation = {
  id: string;
  rule_key: string;
  feature_key: string | null;
  target_level: Level | null;
  title: string | null;
  reason: string | null;
  metric_value: number | null;
  threshold: number | null;
  status: "new" | "seen" | "postponed" | "dismissed" | "accepted";
  created_at: string;
};

/**
 * Open growth recommendations (new or seen), visible to managers. Ones that no longer apply
 * (feature already on, level already reached) are left out. ready=false before the Stage 11 SQL.
 */
export async function loadRecommendations(
  supabase: Supabase,
  companyId: string,
  features: Features,
  level: Level,
): Promise<{ list: Recommendation[]; ready: boolean }> {
  try {
    const { data, error } = await supabase
      .from("company_recommendations")
      .select("id, rule_key, feature_key, target_level, title, reason, metric_value, threshold, status, created_at")
      .eq("company_id", companyId)
      .in("status", ["new", "seen"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { list: [], ready: false };
    const rank = (l: Level | null) => (l === "small" ? 1 : l === "enterprise" ? 3 : l === "medium" ? 2 : 0);
    const list = ((data ?? []) as Recommendation[]).filter((r) =>
      r.target_level ? rank(r.target_level) > rank(level) : r.feature_key ? !features.enabled.has(r.feature_key) : false,
    );
    return { list, ready: true };
  } catch {
    return { list: [], ready: false };
  }
}
