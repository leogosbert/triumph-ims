import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { catalogueUrl, cataloguePhotoUrl } from "@/lib/growth-tools/catalogue";
import { primeLang, tr } from "@/lib/tr";
import { CatalogueView, type ViewProduct } from "./CatalogueView";
import { loadCatalogue, logoUrl, safeColor } from "./data";
import "../catalogue.css";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadCatalogue(slug);
  if (!c) return { title: { absolute: "Catalogue not found" }, robots: { index: false } };
  const title = `${c.company.name} - ${c.headline ?? "Product catalogue"}`;
  const cats = Array.from(new Set(c.products.map((p) => p.category).filter(Boolean))).slice(0, 6);
  const description = (c.seo_description ?? c.intro ?? `${c.company.name}: ${cats.join(", ") || "products"}. Ask for a quotation online.`).slice(0, 300);
  const url = catalogueUrl(c.slug);
  const image = c.products.map((p) => cataloguePhotoUrl(p.photo_path)).find(Boolean) ?? logoUrl(c.company.logo_path);
  return {
    title: { absolute: title.slice(0, 120) },
    description,
    alternates: url.startsWith("http") ? { canonical: url } : undefined,
    openGraph: {
      type: "website",
      title,
      description,
      url: url.startsWith("http") ? url : undefined,
      siteName: c.company.name,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function PublicCataloguePage({ params }: Props) {
  await primeLang();
  const { slug } = await params;
  const c = await loadCatalogue(slug);
  if (!c) notFound();
  const co = c.company;
  const brand = safeColor(co.primary_color, "#1c4d9c");
  const dark = safeColor(co.accent_color, "#123a7a");
  const logo = logoUrl(co.logo_path);
  const products: ViewProduct[] = c.products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    brand: p.brand,
    manufacturer: p.manufacturer,
    part_no: p.part_no,
    specification: p.specification,
    unit: p.unit,
    pack_size: p.pack_size,
    hazardous: p.hazardous,
    un_number: p.un_number,
    country_of_origin: p.country_of_origin,
    summary: p.summary,
    photo: cataloguePhotoUrl(p.photo_path),
    price: p.price === null || p.price === undefined ? null : Number(p.price),
    documents: p.documents ?? [],
  }));
  const ld = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: co.legal_name ?? co.name,
    url: co.website ?? undefined,
    telephone: co.phone ?? undefined,
    email: co.email ?? undefined,
    address: co.address ?? undefined,
    logo: logo ?? undefined,
  };

  return (
    <div className="cat-page" style={{ ["--cat-brand" as string]: brand, ["--cat-dark" as string]: dark }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <header className="cat-hero">
        <div className="cat-wrap">
          <div className="cat-brandrow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo && <img src={logo} alt={co.name} className="cat-logo" />}
            <div>
              <div className="cat-name">{co.name}</div>
              <div className="cat-kicker">{tr("Product catalogue")}</div>
            </div>
          </div>
          {c.headline && <h1>{c.headline}</h1>}
          {c.intro && <p className="cat-intro">{c.intro}</p>}
          <div className="cat-contact">
            {co.whatsapp && (
              <a href={`https://wa.me/${co.whatsapp}?text=${encodeURIComponent(`${tr("Hello, I saw your catalogue")}: ${catalogueUrl(c.slug)}`)}`} target="_blank" rel="noopener noreferrer" className="cat-btn on">
                WhatsApp
              </a>
            )}
            {co.phone && (
              <a href={`tel:${co.phone.replace(/[^\d+]/g, "")}`} className="cat-btn">
                {tr("Call")} {co.phone}
              </a>
            )}
            {co.email && (
              <a href={`mailto:${co.email}`} className="cat-btn">
                {co.email}
              </a>
            )}
            <a href={`/c/${c.slug}/pdf`} className="cat-btn" target="_blank" rel="noopener">
              {tr("Download PDF")}
            </a>
          </div>
        </div>
      </header>
      <main className="cat-wrap">
        {products.length === 0 ? <p className="cat-muted">{tr("The catalogue is being prepared. Send us a message below.")}</p> : null}
        <CatalogueView slug={c.slug} products={products} currency={co.currency} />
      </main>
      <footer className="cat-wrap cat-foot">
        <p>
          {co.legal_name ?? co.name}
          {co.address && ` · ${co.address}`}
          {co.website && (
            <>
              {" · "}
              <a href={/^https?:\/\//i.test(co.website) ? co.website : `https://${co.website}`} rel="noopener nofollow">
                {co.website.replace(/^https?:\/\//i, "")}
              </a>
            </>
          )}
        </p>
        <p className="cat-muted">{tr("Prices, where shown, are a guide and exclude VAT. Ask for a quotation for your quantities and delivery place.")}</p>
        <p className="cat-muted">{tr("Powered by LeMoSp")}</p>
      </footer>
    </div>
  );
}
