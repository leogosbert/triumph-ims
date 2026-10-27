import { cache } from "react";
import { SLUG_RE } from "@/lib/growth-tools/catalogue";
import { inboxAdmin } from "@/lib/inbox/server";
import type { CatalogueProduct } from "@/lib/pdf/catalogue";

/**
 * The public catalogue, read with the service role key through catalogue_public (it returns only
 * what is published: no stock, no costs, a price only where the product shows it). Server only.
 */
export type PublicCatalogue = {
  slug: string;
  company: {
    name: string;
    legal_name: string | null;
    logo_path: string | null;
    primary_color: string | null;
    accent_color: string | null;
    website: string | null;
    currency: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    whatsapp: string | null;
  };
  headline: string | null;
  intro: string | null;
  seo_description: string | null;
  updated_at: string;
  products: CatalogueProduct[];
};

export const loadCatalogue = cache(async (slug: string): Promise<PublicCatalogue | null> => {
  if (!SLUG_RE.test(slug)) return null;
  const admin = inboxAdmin();
  if (!admin) return null;
  const { data, error } = await admin.rpc("catalogue_public", { p_slug: slug });
  if (error || !data) return null;
  return data as PublicCatalogue;
});

export function logoUrl(path: string | null): string | null {
  if (!path) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/branding/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}

export function safeColor(c: string | null | undefined, fallback: string): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}
