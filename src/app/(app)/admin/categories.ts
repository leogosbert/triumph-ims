import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The SQL file that adds feature categories (LeMoSp ADMIN → Features → Categories). */
export const CATEGORIES_SQL = "supabase/migrations/20261018000500_feature_categories.sql";
export const CATEGORIES_MISSING =
  "This needs the feature categories database update (20261018000500_feature_categories.sql). Run it in Supabase, then refresh this page.";

export type FeatureCategory = { name: string; description: string | null; sort: number };

/** The standard categories, used until the feature categories SQL has been run. */
export const DEFAULT_CATEGORIES = [
  "Overview",
  "Sales",
  "Purchasing",
  "Procurement",
  "Inventory",
  "Logistics",
  "Finance",
  "Analytics",
  "Administration",
  "Improvement",
];

/**
 * The feature categories, in their admin order. Before the SQL is run, ready=false and the
 * standard list is returned so every screen keeps working.
 */
export async function loadCategories(supabase: Supabase): Promise<{ list: FeatureCategory[]; ready: boolean }> {
  const { data, error } = await supabase.from("feature_categories").select("name, description, sort").order("sort").order("name");
  if (error || !Array.isArray(data)) {
    return { list: DEFAULT_CATEGORIES.map((name, i) => ({ name, description: null, sort: (i + 1) * 10 })), ready: false };
  }
  return { list: data as FeatureCategory[], ready: true };
}

/**
 * Groups items by category in the category order. A module that has no category row yet
 * (e.g. before the SQL is run) gets its own group at the end, so nothing is ever hidden.
 */
export function groupByCategory<T extends { module: string | null }>(
  categories: FeatureCategory[],
  items: T[],
  { keepEmpty = false } = {},
): { category: FeatureCategory; items: T[] }[] {
  const groups = categories.map((category) => ({ category, items: [] as T[] }));
  for (const item of items) {
    const name = item.module || "Other";
    let g = groups.find((x) => x.category.name === name);
    if (!g) {
      g = { category: { name, description: null, sort: 100000 }, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return keepEmpty ? groups : groups.filter((g) => g.items.length > 0);
}

/** Category names travel in URLs: /admin/features/categories/<encoded name>. */
export const categoryHref = (name: string) => `/admin/features/categories/${encodeURIComponent(name)}`;
