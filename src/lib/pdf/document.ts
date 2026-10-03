import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

/** Everything needed to print a business document (quotation, purchase order, request for quotation). */
export type DocCompany = {
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

export type DocLine = {
  line_no: number;
  description: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_price?: number;
  discount_pct?: number;
  line_total?: number;
};

export type DocData = {
  title: string;
  company: DocCompany;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  meta: [string, string | null | undefined][];
  partyLabel: string;
  party: { name: string; lines: (string | null | undefined)[] };
  currency: string;
  mode: "priced" | "priced-discount" | "unpriced" | "quantities";
  lines: DocLine[];
  totals?: { rows: [string, number, boolean?][]; grandLabel: string; grand: number };
  blocks: { title: string; body: string | null | undefined }[];
  signature?: string | null;
  watermark?: string | null;
  showBank?: boolean;
  /** Delivery note sign-off: empty boxes to sign on paper, or the captured signature. */
  signoff?: {
    deliveredBy: string | null;
    receivedBy: string | null;
    when: string | null;
    gps: string | null;
    signature: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  };
};

const A4 = { w: 595.28, h: 841.89 };
const M = 40;

/** Standard PDF fonts only know Western characters; replace or drop the rest. */
export function clean(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/\t/g, " ")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

function hex(c: string, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

export function pdfMoney(n: number, currency: string) {
  const decimals = currency === "TZS" ? 0 : 2;
  return Number(n).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function pdfDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
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

export async function buildDocumentPdf(d: DocData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.title} ${clean(d.meta[0]?.[1] ?? "")}`);
  pdf.setAuthor(clean(d.company.name));
  pdf.setCreator("TRIUMPH IMS");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hex(d.company.primary_color, rgb(0.11, 0.3, 0.61));
  const dark = hex(d.company.accent_color, rgb(0.07, 0.23, 0.48));
  const ink = rgb(0.08, 0.13, 0.18);
  const muted = rgb(0.36, 0.4, 0.46);
  const rule = rgb(0.85, 0.88, 0.91);
  const zebra = rgb(0.965, 0.973, 0.984);

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
  type T = { size?: number; f?: PDFFont; color?: RGB };
  const text = (s: string, x: number, yy: number, o: T = {}) =>
    page.drawText(clean(s), { x, y: yy, size: o.size ?? 9, font: o.f ?? font, color: o.color ?? ink });
  const right = (s: string, xr: number, yy: number, o: T = {}) => {
    const f = o.f ?? font;
    const size = o.size ?? 9;
    text(s, xr - f.widthOfTextAtSize(clean(s), size), yy, o);
  };

  const priced = d.mode === "priced" || d.mode === "priced-discount";
  const withDisc = d.mode === "priced-discount";
  const cols = priced
    ? withDisc
      ? { no: M, desc: M + 22, qtyR: 330, unit: 336, priceR: 450, discR: 488, amountR: A4.w - M }
      : { no: M, desc: M + 22, qtyR: 360, unit: 366, priceR: 470, discR: 0, amountR: A4.w - M }
    : { no: M, desc: M + 22, qtyR: 392, unit: 400, priceR: 0, discR: 0, amountR: A4.w - M };
  const descWidth = cols.qtyR - 40 - cols.desc;

  function tableHeader() {
    page.drawRectangle({ x: M, y: y - 6, width: A4.w - 2 * M, height: 20, color: dark });
    const o = { f: bold, size: 8.5, color: rgb(1, 1, 1) };
    text("#", cols.no + 4, y, o);
    text("Description", cols.desc, y, o);
    right("Qty", cols.qtyR, y, o);
    text("Unit", cols.unit, y, o);
    if (priced) {
      right("Unit price", cols.priceR, y, o);
      if (withDisc) right("Disc.", cols.discR, y, o);
      right(`Amount (${d.currency})`, cols.amountR - 4, y, o);
    } else if (d.mode === "quantities") {
      right("Checked", cols.amountR - 4, y, o);
    } else {
      right("Your price / unit", cols.amountR - 4, y, o);
    }
    y -= 22;
  }

  function newPage(first: boolean) {
    page = pdf.addPage([A4.w, A4.h]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: brand });
    y = A4.h - 40;
    if (d.watermark) {
      page.drawText(clean(d.watermark), {
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
      text(`${d.company.name}  -  ${d.title} ${d.meta[0]?.[1] ?? ""} (continued)`, M, y, { size: 9, color: muted });
      y -= 24;
      tableHeader();
    }
  }

  // ---------------- Header ----------------
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
    [d.company.tin ? `TIN: ${d.company.tin}` : null, d.company.vrn ? `VRN: ${d.company.vrn}` : null].filter(Boolean).join("   "),
  ].filter(Boolean) as string[];
  for (const l of companyLines) {
    for (const w of wrap(l, font, 8.5, 250)) {
      text(w, leftX, hy, { size: 8.5, color: muted });
      hy -= 11;
    }
  }

  // Title on the right, shrunk so it never runs into the company name on the left.
  const nameEnd = leftX + bold.widthOfTextAtSize(clean(d.company.name), 15) + 18;
  const room = A4.w - M - nameEnd;
  let titleSize = 22;
  while (titleSize > 11 && bold.widthOfTextAtSize(clean(d.title), titleSize) > room) titleSize -= 0.5;
  right(d.title, A4.w - M, y - 2, { f: bold, size: titleSize, color: brand });
  let my = y - 24;
  for (const [k, v] of d.meta) {
    if (!v) continue;
    right(v, A4.w - M, my, { f: bold, size: 9 });
    right(`${k}:`, A4.w - M - bold.widthOfTextAtSize(clean(v), 9) - 6, my, { size: 9, color: muted });
    my -= 12;
  }
  y = Math.min(hy, my, y - 60) - 14;

  // ---------------- Party box ----------------
  const boxTop = y;
  const partyLines = [
    ...wrap(d.party.name, bold, 10.5, 480).map((t) => ({ t, f: bold, s: 10.5 })),
    ...d.party.lines.filter(Boolean).flatMap((l) => wrap(l as string, font, 9, 480).map((t) => ({ t, f: font, s: 9 }))),
  ];
  const boxH = 22 + partyLines.length * 12;
  page.drawRectangle({ x: M, y: boxTop - boxH + 10, width: A4.w - 2 * M, height: boxH, color: zebra, borderColor: rule, borderWidth: 0.6 });
  text(d.partyLabel.toUpperCase(), M + 10, boxTop - 4, { f: bold, size: 7.5, color: muted });
  let cy = boxTop - 18;
  for (const l of partyLines) {
    text(l.t, M + 10, cy, { f: l.f, size: l.s });
    cy -= 12;
  }
  y = boxTop - boxH - 10;

  // ---------------- Lines ----------------
  tableHeader();
  d.lines.forEach((l, i) => {
    const descLines = wrap(l.description, font, 9, descWidth);
    const hasSku = !!l.sku;
    if (hasSku) descLines.push(`Code: ${l.sku}`);
    const rowH = Math.max(1, descLines.length) * 11 + (priced ? 8 : 14);
    if (y - rowH < 90) newPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + 9, width: A4.w - 2 * M, height: rowH, color: zebra });
    text(String(l.line_no), cols.no + 4, y);
    descLines.forEach((t, k) => {
      const isSku = hasSku && k === descLines.length - 1;
      text(t, cols.desc, y - k * 11, { color: isSku ? muted : ink, size: isSku ? 7.5 : 9 });
    });
    right(Number(l.quantity).toLocaleString("en-GB", { maximumFractionDigits: 3 }), cols.qtyR, y);
    text(l.unit, cols.unit, y);
    if (priced) {
      right(pdfMoney(l.unit_price ?? 0, d.currency), cols.priceR, y);
      if (withDisc) right(Number(l.discount_pct ?? 0) > 0 ? `${Number(l.discount_pct)}%` : "", cols.discR, y);
      right(pdfMoney(l.line_total ?? 0, d.currency), cols.amountR - 4, y, { f: bold });
    } else if (d.mode === "quantities") {
      page.drawRectangle({ x: cols.amountR - 20, y: y - 3, width: 11, height: 11, borderColor: muted, borderWidth: 0.7 });
    } else {
      page.drawLine({ start: { x: cols.amountR - 90, y: y - 3 }, end: { x: cols.amountR - 4, y: y - 3 }, thickness: 0.5, color: muted });
    }
    y -= rowH;
  });
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: A4.w - M, y: y + 8 }, thickness: 0.6, color: rule });

  // ---------------- Totals ----------------
  if (d.totals) {
    if (y < 170) newPage(false);
    y -= 8;
    for (const [k, v, negative] of d.totals.rows) {
      right(k, 450, y, { color: muted });
      right(`${negative ? "- " : ""}${pdfMoney(v, d.currency)}`, A4.w - M - 4, y);
      y -= 14;
    }
    y -= 8;
    page.drawRectangle({ x: 330, y: y - 8, width: A4.w - M - 330, height: 22, color: dark });
    text(d.totals.grandLabel, 340, y, { f: bold, size: 11, color: rgb(1, 1, 1) });
    right(pdfMoney(d.totals.grand, d.currency), A4.w - M - 8, y, { f: bold, size: 12, color: rgb(1, 1, 1) });
    y -= 36;
  } else {
    y -= 14;
  }

  // ---------------- Text blocks ----------------
  const blocks = [...d.blocks];
  if (d.showBank && d.company.bank_details) blocks.push({ title: "Bank details", body: d.company.bank_details });
  for (const b of blocks) {
    if (!b.body) continue;
    const body = wrap(b.body, font, 8.5, A4.w - 2 * M);
    if (y - 14 - Math.min(body.length, 4) * 11 < 70) newPage(false);
    text(b.title.toUpperCase(), M, y, { f: bold, size: 8, color: brand });
    y -= 12;
    for (const t of body) {
      if (y < 70) newPage(false);
      text(t, M, y, { size: 8.5 });
      y -= 11;
    }
    y -= 8;
  }

  if (d.signoff) {
    const so = d.signoff;
    let sig: PDFImage | null = null;
    if (so.signature) {
      try {
        sig = so.signature.type === "png" ? await pdf.embedPng(so.signature.bytes) : await pdf.embedJpg(so.signature.bytes);
      } catch {
        sig = null;
      }
    }
    const boxH = 118;
    if (y - boxH < 70) newPage(false);
    const w = (A4.w - 2 * M - 16) / 2;
    const top = y + 4;
    const boxes: { x: number; title: string }[] = [
      { x: M, title: "Delivered by" },
      { x: M + w + 16, title: "Received in good order by" },
    ];
    for (const b of boxes) {
      page.drawRectangle({ x: b.x, y: top - boxH, width: w, height: boxH, borderColor: rule, borderWidth: 0.8 });
      text(b.title.toUpperCase(), b.x + 8, top - 14, { f: bold, size: 7.5, color: brand });
    }
    // Left: driver
    text(`Name: ${so.deliveredBy ?? ""}`, M + 8, top - 32, { size: 9 });
    if (!so.deliveredBy) page.drawLine({ start: { x: M + 40, y: top - 34 }, end: { x: M + w - 10, y: top - 34 }, thickness: 0.5, color: muted });
    text("Signature:", M + 8, top - 62, { size: 9, color: muted });
    page.drawLine({ start: { x: M + 58, y: top - 64 }, end: { x: M + w - 10, y: top - 64 }, thickness: 0.5, color: muted });
    text("Date:", M + 8, top - 92, { size: 9, color: muted });
    page.drawLine({ start: { x: M + 36, y: top - 94 }, end: { x: M + w - 10, y: top - 94 }, thickness: 0.5, color: muted });
    // Right: client
    const rx = M + w + 16;
    if (so.receivedBy) {
      text(`Name: ${so.receivedBy}`, rx + 8, top - 32, { size: 9, f: bold });
      if (sig) {
        const sh = 46;
        const sw = Math.min((sig.width / sig.height) * sh, w - 20);
        page.drawImage(sig, { x: rx + 8, y: top - 84, width: sw, height: (sw / sig.width) * sig.height });
      }
      text(so.when ?? "", rx + 8, top - 96, { size: 8.5 });
      if (so.gps) text(so.gps, rx + 8, top - 108, { size: 7.5, color: muted });
    } else {
      text("Name:", rx + 8, top - 32, { size: 9, color: muted });
      page.drawLine({ start: { x: rx + 40, y: top - 34 }, end: { x: rx + w - 10, y: top - 34 }, thickness: 0.5, color: muted });
      text("Signature:", rx + 8, top - 62, { size: 9, color: muted });
      page.drawLine({ start: { x: rx + 58, y: top - 64 }, end: { x: rx + w - 10, y: top - 64 }, thickness: 0.5, color: muted });
      text("Date / stamp:", rx + 8, top - 92, { size: 9, color: muted });
      page.drawLine({ start: { x: rx + 66, y: top - 94 }, end: { x: rx + w - 10, y: top - 94 }, thickness: 0.5, color: muted });
    }
    y = top - boxH - 16;
  }

  if (d.signature) {
    if (y < 110) newPage(false);
    y -= 10;
    for (const t of clean(d.signature).split("\n")) {
      text(t, M, y, { size: 9, color: t.startsWith("For ") ? muted : ink });
      y -= 12;
    }
  }

  // ---------------- Footers ----------------
  const footer = d.company.document_footer ? clean(d.company.document_footer).replace(/\n/g, "  ") : "";
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 46 }, end: { x: A4.w - M, y: 46 }, thickness: 0.5, color: rule });
    if (footer) {
      wrap(footer, font, 7.5, A4.w - 2 * M - 70)
        .slice(0, 2)
        .forEach((t, k) => p.drawText(t, { x: M, y: 34 - k * 9, size: 7.5, font, color: muted }));
    }
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: A4.w - M - font.widthOfTextAtSize(label, 7.5), y: 34, size: 7.5, font, color: muted });
  });

  return pdf.save();
}
