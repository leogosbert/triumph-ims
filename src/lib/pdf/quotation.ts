import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

export type QuotePdfData = {
  company: {
    name: string;
    legal_name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    tin: string | null;
    vrn: string | null;
    primary_color: string;
    accent_color: string;
    bank_details: string | null;
    document_footer: string | null;
  };
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  quote: {
    number: string;
    status: string;
    issue_date: string;
    valid_until: string | null;
    currency: string;
    contact_name: string | null;
    client_ref: string | null;
    rfq_number: string | null;
    delivery_time: string | null;
    payment_terms: string | null;
    incoterms: string | null;
    vat_rate: number;
    subtotal: number;
    discount_total: number;
    vat_amount: number;
    total: number;
    notes: string | null;
    terms: string | null;
    prepared_by: string | null;
  };
  client: { name: string; address: string | null; tin: string | null; vrn: string | null };
  lines: {
    line_no: number;
    description: string;
    sku: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    discount_pct: number;
    line_total: number;
  }[];
};

const A4 = { w: 595.28, h: 841.89 };
const M = 40; // page margin

/** Standard PDF fonts only know Western characters; replace or drop the rest. */
function clean(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/\t/g, " ")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

function hex(c: string, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function money(n: number, decimals: number) {
  return Number(n).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function date(iso: string | null) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        if (line) out.push(line);
        // A single very long word: hard-break it.
        let word = w;
        while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
          let cut = word.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function buildQuotationPdf(d: QuotePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Quotation ${clean(d.quote.number)}`);
  pdf.setAuthor(clean(d.company.name));
  pdf.setCreator("TRIUMPH IMS");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hex(d.company.primary_color, rgb(0.11, 0.3, 0.61));
  const dark = hex(d.company.accent_color, rgb(0.07, 0.23, 0.48));
  const ink = rgb(0.08, 0.13, 0.18);
  const muted = rgb(0.36, 0.4, 0.46);
  const line = rgb(0.85, 0.88, 0.91);
  const zebra = rgb(0.965, 0.973, 0.984);
  const decimals = d.quote.currency === "TZS" ? 0 : 2;
  const approved = ["approved", "sent", "accepted"].includes(d.quote.status);

  let logo: PDFImage | null = null;
  if (d.logo) {
    try {
      logo = d.logo.type === "png" ? await pdf.embedPng(d.logo.bytes) : await pdf.embedJpg(d.logo.bytes);
    } catch {
      logo = null;
    }
  }

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const text = (s: string, x: number, yy: number, opts: { size?: number; f?: PDFFont; color?: RGB } = {}) =>
    page.drawText(clean(s), { x, y: yy, size: opts.size ?? 9, font: opts.f ?? font, color: opts.color ?? ink });
  const right = (s: string, xr: number, yy: number, opts: { size?: number; f?: PDFFont; color?: RGB } = {}) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 9;
    text(s, xr - f.widthOfTextAtSize(clean(s), size), yy, opts);
  };

  // Table columns: # | Description | Qty | Unit | Unit price | Disc | Amount
  const cols = { no: M, desc: M + 22, qtyR: 330, unit: 336, priceR: 450, discR: 488, amountR: A4.w - M };
  const descWidth = cols.qtyR - 40 - cols.desc;

  function tableHeader() {
    page.drawRectangle({ x: M, y: y - 6, width: A4.w - 2 * M, height: 20, color: dark });
    const o = { f: bold, size: 8.5, color: rgb(1, 1, 1) };
    text("#", cols.no + 4, y, o);
    text("Description", cols.desc, y, o);
    right("Qty", cols.qtyR, y, o);
    text("Unit", cols.unit, y, o);
    right(`Unit price`, cols.priceR, y, o);
    right("Disc.", cols.discR, y, o);
    right(`Amount (${d.quote.currency})`, cols.amountR - 4, y, o);
    y -= 22;
  }

  function newPage(first: boolean) {
    page = pdf.addPage([A4.w, A4.h]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: brand });
    y = A4.h - 40;
    if (!approved) {
      page.drawText("DRAFT - NOT APPROVED", {
        x: 120,
        y: 330,
        size: 46,
        font: bold,
        color: rgb(0.9, 0.3, 0.25),
        opacity: 0.12,
        rotate: degrees(35),
      });
    }
    if (!first) {
      text(`${d.company.name}  -  Quotation ${d.quote.number} (continued)`, M, y, { size: 9, color: muted });
      y -= 24;
      tableHeader();
    }
  }


  // ---------------- First page header ----------------
  newPage(true);
  let leftX = M;
  if (logo) {
    const h = 54;
    const w = Math.min((logo.width / logo.height) * h, 140);
    const hh = (w / logo.width) * logo.height;
    page.drawImage(logo, { x: M, y: y - hh + 14, width: w, height: hh });
    leftX = M + w + 12;
  }
  text(d.company.name, leftX, y, { f: bold, size: 15, color: dark });
  let hy = y - 15;
  const companyLines = [
    d.company.legal_name && d.company.legal_name !== d.company.name ? d.company.legal_name : null,
    d.company.address,
    [d.company.phone, d.company.email].filter(Boolean).join("  |  "),
    d.company.website,
  ].filter(Boolean) as string[];
  for (const l of companyLines) {
    for (const w of wrap(l, font, 8.5, 250)) {
      text(w, leftX, hy, { size: 8.5, color: muted });
      hy -= 11;
    }
  }
  const ids = [d.company.tin ? `TIN: ${d.company.tin}` : null, d.company.vrn ? `VRN: ${d.company.vrn}` : null].filter(
    Boolean,
  ) as string[];
  if (ids.length) {
    text(ids.join("   "), leftX, hy, { size: 8.5, color: muted });
    hy -= 11;
  }

  right("QUOTATION", A4.w - M, y - 2, { f: bold, size: 22, color: brand });
  const meta: [string, string][] = [
    ["Quotation no.", d.quote.number],
    ["Date", date(d.quote.issue_date)],
    ["Valid until", date(d.quote.valid_until)],
  ];
  if (d.quote.client_ref) meta.push(["Your reference", d.quote.client_ref]);
  if (d.quote.rfq_number) meta.push(["Our RFQ no.", d.quote.rfq_number]);
  let my = y - 24;
  for (const [k, v] of meta) {
    if (!v) continue;
    right(v, A4.w - M, my, { f: bold, size: 9 });
    right(`${k}:`, A4.w - M - bold.widthOfTextAtSize(clean(v), 9) - 6, my, { size: 9, color: muted });
    my -= 12;
  }
  y = Math.min(hy, my, y - 60) - 14;

  // ---------------- Client box ----------------
  const boxTop = y;
  const clientLines = [
    ...wrap(d.client.name, bold, 10.5, 300).map((t) => ({ t, f: bold, s: 10.5 })),
    ...(d.client.address ? wrap(d.client.address, font, 9, 300).map((t) => ({ t, f: font, s: 9 })) : []),
    ...([d.client.tin ? `TIN: ${d.client.tin}` : null, d.client.vrn ? `VRN: ${d.client.vrn}` : null].filter(Boolean).length
      ? [{ t: [d.client.tin ? `TIN: ${d.client.tin}` : null, d.client.vrn ? `VRN: ${d.client.vrn}` : null].filter(Boolean).join("   "), f: font, s: 9 }]
      : []),
    ...(d.quote.contact_name ? [{ t: `Attention: ${d.quote.contact_name}`, f: font, s: 9 }] : []),
  ];
  const boxH = 22 + clientLines.length * 12;
  page.drawRectangle({ x: M, y: boxTop - boxH + 10, width: A4.w - 2 * M, height: boxH, color: zebra, borderColor: line, borderWidth: 0.6 });
  text("QUOTATION FOR", M + 10, boxTop - 4, { f: bold, size: 7.5, color: muted });
  let cy = boxTop - 18;
  for (const l of clientLines) {
    text(l.t, M + 10, cy, { f: l.f, size: l.s });
    cy -= 12;
  }
  y = boxTop - boxH - 10;

  // ---------------- Lines ----------------
  tableHeader();
  d.lines.forEach((l, i) => {
    const descLines = wrap(l.description, font, 9, descWidth);
    if (l.sku) descLines.push(`Code: ${l.sku}`);
    const rowH = Math.max(1, descLines.length) * 11 + 8;
    if (y - rowH < 90) newPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + 9, width: A4.w - 2 * M, height: rowH, color: zebra });
    text(String(l.line_no), cols.no + 4, y);
    descLines.forEach((t, k) => text(t, cols.desc, y - k * 11, { color: k === descLines.length - 1 && l.sku ? muted : ink, size: k === descLines.length - 1 && l.sku ? 7.5 : 9 }));
    right(Number(l.quantity).toLocaleString("en-GB", { maximumFractionDigits: 3 }), cols.qtyR, y);
    text(l.unit, cols.unit, y);
    right(money(l.unit_price, decimals), cols.priceR, y);
    right(Number(l.discount_pct) > 0 ? `${Number(l.discount_pct)}%` : "", cols.discR, y);
    right(money(l.line_total, decimals), cols.amountR - 4, y, { f: bold });
    y -= rowH;
  });
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: A4.w - M, y: y + 8 }, thickness: 0.6, color: line });

  // ---------------- Totals ----------------
  if (y < 160) newPage(false);
  y -= 8;
  const totals: [string, string, boolean][] = [];
  if (d.quote.discount_total > 0) totals.push(["Discounts included", `- ${money(d.quote.discount_total, decimals)}`, false]);
  totals.push(["Subtotal", money(d.quote.subtotal, decimals), false]);
  totals.push([`VAT ${Number(d.quote.vat_rate)}%`, money(d.quote.vat_amount, decimals), false]);
  for (const [k, v] of totals) {
    right(k, 450, y, { color: muted });
    right(v, A4.w - M - 4, y);
    y -= 14;
  }
  y -= 8;
  page.drawRectangle({ x: 330, y: y - 8, width: A4.w - M - 330, height: 22, color: dark });
  text(`TOTAL ${d.quote.currency}`, 340, y, { f: bold, size: 11, color: rgb(1, 1, 1) });
  right(money(d.quote.total, decimals), A4.w - M - 8, y, { f: bold, size: 12, color: rgb(1, 1, 1) });
  y -= 36;

  // ---------------- Terms ----------------
  const termRows: [string, string | null][] = [
    ["Delivery", d.quote.delivery_time],
    ["Payment terms", d.quote.payment_terms],
    ["Incoterms", d.quote.incoterms],
    ["Validity", d.quote.valid_until ? `This quotation is valid until ${date(d.quote.valid_until)}.` : null],
  ];
  const blocks: { title: string; body: string }[] = [];
  const shortTerms = termRows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  if (shortTerms) blocks.push({ title: "Commercial terms", body: shortTerms });
  if (d.quote.notes) blocks.push({ title: "Notes", body: d.quote.notes });
  if (d.quote.terms) blocks.push({ title: "Terms and conditions", body: d.quote.terms });
  if (d.company.bank_details) blocks.push({ title: "Bank details", body: d.company.bank_details });

  for (const b of blocks) {
    const body = wrap(b.body, font, 8.5, A4.w - 2 * M);
    if (y - 14 - body.length * 11 < 70) newPage(false);
    text(b.title.toUpperCase(), M, y, { f: bold, size: 8, color: brand });
    y -= 12;
    for (const t of body) {
      if (y < 70) {
        newPage(false);
      }
      text(t, M, y, { size: 8.5 });
      y -= 11;
    }
    y -= 8;
  }

  if (d.quote.prepared_by) {
    if (y < 110) newPage(false);
    y -= 10;
    text(`Prepared by: ${d.quote.prepared_by}`, M, y, { size: 9 });
    text(`For and on behalf of ${d.company.name}`, M, y - 12, { size: 9, color: muted });
  }

  // ---------------- Footers ----------------
  const footer = d.company.document_footer ? clean(d.company.document_footer).replace(/\n/g, "  ") : "";
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 46 }, end: { x: A4.w - M, y: 46 }, thickness: 0.5, color: line });
    if (footer) {
      const f = wrap(footer, font, 7.5, A4.w - 2 * M - 70).slice(0, 2);
      f.forEach((t, k) => p.drawText(t, { x: M, y: 34 - k * 9, size: 7.5, font, color: muted }));
    }
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: A4.w - M - font.widthOfTextAtSize(label, 7.5), y: 34, size: 7.5, font, color: muted });
  });

  return pdf.save();
}
