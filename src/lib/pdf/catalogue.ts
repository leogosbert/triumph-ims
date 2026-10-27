import type { PDFImage } from "pdf-lib";
import { qrEncode } from "@/lib/growth-tools/qr";
import { pdfMoney, type DocCompany } from "./document";
import { Report, wrapText } from "./report";

/**
 * The catalogue as a PDF (the same products as the public page: no stock, no costs, prices only where
 * the product is switched to show its price), with the page's QR code on the cover.
 */

export type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  manufacturer: string | null;
  part_no: string | null;
  specification: string | null;
  unit: string | null;
  pack_size: string | null;
  hazardous: boolean | null;
  un_number: string | null;
  country_of_origin: string | null;
  summary: string | null;
  photo_path: string | null;
  price: number | string | null;
  documents: { id: string; title: string; kind: string }[];
};

export async function buildCataloguePdf(d: {
  company: DocCompany;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  currency: string;
  headline: string | null;
  intro: string | null;
  url: string;
  contact: { phone: string | null; email: string | null; whatsapp: string | null; address: string | null };
  products: CatalogueProduct[];
  /** Photos (JPG/PNG) by product id; others are skipped. */
  photos: Map<string, { bytes: Uint8Array; type: "png" | "jpg" }>;
}): Promise<Uint8Array> {
  const r = await Report.create(d.company, d.logo, "Product catalogue", `${d.company.name} product catalogue`);
  r.newPage(true);
  r.space(30);
  r.text("PRODUCT CATALOGUE", r.left, r.y, { bold: true, size: 26, color: r.brand });
  r.space(30);
  if (d.headline) r.para(d.headline, { bold: true, size: 13, gap: 8 });
  if (d.intro) r.para(d.intro, { size: 10.5, gap: 12 });
  const cats = Array.from(new Set(d.products.map((p) => p.category || "Other products")));
  r.para(`${d.products.length} products in ${cats.length} ${cats.length === 1 ? "category" : "categories"}: ${cats.slice(0, 12).join(", ")}${cats.length > 12 ? " ..." : ""}`, { color: r.muted, gap: 20 });

  const qr = qrEncode(d.url);
  const top = r.y;
  if (qr) {
    r.qr(qr.modules, r.left, top, 120);
    r.text("Scan to see the catalogue", r.left + 140, top - 16, { bold: true, size: 11 });
    r.text("and ask for a quotation online:", r.left + 140, top - 32, { size: 10 });
    r.text(d.url, r.left + 140, top - 52, { size: 10, color: r.brand });
  }
  r.y = top - 150;
  r.heading("Contact us");
  r.rows([
    ["Phone", d.contact.phone],
    ["WhatsApp", d.contact.whatsapp ? `+${d.contact.whatsapp}` : null],
    ["Email", d.contact.email],
    ["Address", d.contact.address],
    ["Website", d.company.website],
  ], 90);

  const embedded = new Map<string, PDFImage>();
  for (const [id, ph] of d.photos) {
    try {
      embedded.set(id, ph.type === "png" ? await r.doc.embedPng(ph.bytes) : await r.doc.embedJpg(ph.bytes));
    } catch {
      /* skip a broken photo */
    }
  }

  let current: string | null = null;
  r.newPage(false);
  for (const p of d.products) {
    const cat = p.category || "Other products";
    if (cat !== current) {
      current = cat;
      r.need(90);
      r.title(cat);
    }
    const img = embedded.get(p.id);
    const textX = r.left + (img ? 92 : 0);
    const width = r.width - (img ? 92 : 0) - (p.price != null ? 110 : 0);
    const details = [
      [p.brand, p.manufacturer && p.manufacturer !== p.brand ? p.manufacturer : null].filter(Boolean).join(" / "),
      [p.sku ? `Code ${p.sku}` : null, p.part_no ? `Part no. ${p.part_no}` : null, p.pack_size ? `Pack ${p.pack_size}` : null, p.unit ? `Unit ${p.unit}` : null].filter(Boolean).join("  |  "),
      p.summary,
      p.specification,
      [p.country_of_origin ? `Origin: ${p.country_of_origin}` : null, p.hazardous ? `Hazardous${p.un_number ? ` (UN ${p.un_number})` : ""}: SDS available on request` : null].filter(Boolean).join("  |  "),
      p.documents.length ? `Downloads on the web page: ${p.documents.map((x) => x.title).join(", ")}` : null,
    ].filter((x): x is string => !!x);
    const lines = details.flatMap((t) => wrapText(t, r.font, 8.5, width)).slice(0, 12);
    const h = Math.max(img ? 84 : 0, 16 + lines.length * 11) + 12;
    r.need(h);
    const y0 = r.y;
    if (img) {
      const s = Math.min(80 / img.width, 80 / img.height);
      r.page.drawImage(img, { x: r.left + (80 - img.width * s) / 2, y: y0 - 72 + (80 - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
    r.text(p.name, textX, y0, { bold: true, size: 10.5 });
    if (p.price != null) r.right(`${d.currency} ${pdfMoney(Number(p.price), d.currency)}`, r.left + r.width, y0, { bold: true, size: 10, color: r.brand });
    if (p.price != null) r.right(`per ${p.unit ?? "unit"}, VAT excl.`, r.left + r.width, y0 - 12, { size: 7.5, color: r.muted });
    lines.forEach((t, i) => r.text(t, textX, y0 - 15 - i * 11, { size: 8.5, color: i === 0 ? r.ink : r.muted }));
    r.y = y0 - h;
    r.page.drawLine({ start: { x: r.left, y: r.y + 6 }, end: { x: r.left + r.width, y: r.y + 6 }, thickness: 0.4, color: r.rule });
    r.space(6);
  }
  r.need(40);
  r.space(10);
  r.para("Prices, where shown, are a guide and exclude VAT; ask us for a quotation for your quantities and delivery place.", { size: 8.5, color: r.muted });
  r.footers(`${d.company.name} - product catalogue - ${d.url}`);
  return r.doc.save();
}
