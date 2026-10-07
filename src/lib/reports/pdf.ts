import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { clean } from "@/lib/pdf/document";
import type { Cell, Col, Row } from "@/lib/reports/defs";

/** Rows printed in one PDF; bigger reports are cut here (Excel has them all). */
export const PDF_MAX_ROWS = 5000;

export type ReportPdfInput = {
  company: string;
  brand: string;
  title: string;
  lines: string[];
  headers: string[];
  cols: Col[];
  rows: Row[];
  totals: Row | null;
  totalLabel: string;
  footer: string;
  pageLabel: string;
  cutNote: string | null;
  emptyNote: string;
};

const W = 841.89;
const H = 595.28;
const M = 32;

function hex(c: string, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

const numeric = (c: Col) => c.type === "money" || c.type === "qty" || c.type === "int" || c.type === "percent";

/** Shortens text to fit a width, ending with "...". */
function fit(s: string, font: PDFFont, size: number, width: number) {
  const t = clean(s).replace(/\s+/g, " ");
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${t.slice(0, mid)}...`, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${t.slice(0, lo)}...` : "";
}

export async function buildReportPdf(x: ReportPdfInput, display: (c: Col, v: Cell) => string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`${x.title} - ${x.company}`));
  pdf.setAuthor(clean(x.company));
  pdf.setCreator("LeMoSp");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hex(x.brand, rgb(0.11, 0.3, 0.61));
  const ink = rgb(0.08, 0.13, 0.18);
  const muted = rgb(0.36, 0.4, 0.46);
  const rule = rgb(0.8, 0.84, 0.88);
  const zebra = rgb(0.958, 0.966, 0.978);
  const headFill = rgb(0.86, 0.9, 0.95);

  const rows = x.rows.slice(0, PDF_MAX_ROWS);
  const size = x.cols.length > 10 ? 6.8 : x.cols.length > 7 ? 7.6 : 8.5;
  const pad = 4;
  const usable = W - 2 * M;

  // Column widths: what each column needs (header and a sample of values), then scaled to the page.
  const sample = rows.slice(0, 300);
  const need = x.cols.map((c, i) => {
    let w = Math.min(bold.widthOfTextAtSize(clean(x.headers[i]), size), 90);
    for (const r of sample) w = Math.max(w, font.widthOfTextAtSize(clean(display(c, r[c.key])), size));
    if (x.totals && c.key in x.totals) w = Math.max(w, bold.widthOfTextAtSize(clean(display(c, x.totals[c.key])), size));
    return Math.min(Math.max(w, 28), c.type === "text" ? 220 : 120) + 2 * pad;
  });
  const sum = need.reduce((a, b) => a + b, 0);
  const textCount = x.cols.filter((c) => c.type === "text").length;
  // Too wide: shrink every column. Room to spare: give it to the text columns.
  const widths =
    sum > usable
      ? need.map((w) => (w * usable) / sum)
      : need.map((w, i) => w + (textCount ? (x.cols[i].type === "text" ? (usable - sum) / textCount : 0) : (usable - sum) / need.length));

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const rowH = size + 7;

  // Header labels can wrap onto two lines.
  const headLines = x.headers.map((h, i) => {
    const words = clean(h).split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (bold.widthOfTextAtSize(t, size) <= widths[i] - 2 * pad || !line) line = t;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, 2).map((l) => fit(l, bold, size, widths[i] - 2 * pad));
  });
  const headH = (Math.max(...headLines.map((l) => l.length), 1) * (size + 2)) + 8;

  const drawHeaderRow = () => {
    page.drawRectangle({ x: M, y: y - headH, width: usable, height: headH, color: headFill });
    let cx = M;
    x.cols.forEach((c, i) => {
      headLines[i].forEach((l, k) => {
        const ty = y - 4 - size - k * (size + 2);
        const tw = bold.widthOfTextAtSize(l, size);
        page.drawText(l, { x: numeric(c) ? cx + widths[i] - pad - tw : cx + pad, y: ty, size, font: bold, color: ink });
      });
      cx += widths[i];
    });
    y -= headH;
  };

  const newPage = (first: boolean) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (first) {
      page.drawText(fit(x.company, bold, 15, usable), { x: M, y: y - 14, size: 15, font: bold, color: brand });
      y -= 32;
      page.drawText(fit(x.title, bold, 12, usable), { x: M, y, size: 12, font: bold, color: ink });
      y -= 15;
      for (const l of x.lines) {
        if (!l) continue;
        page.drawText(fit(l, font, 8.5, usable), { x: M, y, size: 8.5, font, color: muted });
        y -= 12;
      }
      y -= 6;
    } else {
      page.drawText(fit(`${x.company} - ${x.title}`, bold, 9, usable), { x: M, y: y - 8, size: 9, font: bold, color: muted });
      y -= 18;
    }
    if (x.cols.length) drawHeaderRow();
  };

  const drawRow = (r: Row, i: number, totals: boolean) => {
    if (y - rowH < M + 20) newPage(false);
    if (totals) {
      page.drawLine({ start: { x: M, y }, end: { x: M + usable, y }, thickness: 0.9, color: ink });
    } else if (i % 2 === 1) {
      page.drawRectangle({ x: M, y: y - rowH, width: usable, height: rowH, color: zebra });
    }
    let cx = M;
    const f = totals ? bold : font;
    x.cols.forEach((c, k) => {
      let s = display(c, r[c.key]);
      if (totals && k === 0 && !(c.key in r)) s = x.totalLabel;
      const t = fit(s, f, size, widths[k] - 2 * pad);
      if (t) {
        const tw = f.widthOfTextAtSize(t, size);
        page.drawText(t, { x: numeric(c) ? cx + widths[k] - pad - tw : cx + pad, y: y - rowH + 4.5, size, font: f, color: ink });
      }
      cx += widths[k];
    });
    y -= rowH;
    if (!totals) page.drawLine({ start: { x: M, y }, end: { x: M + usable, y }, thickness: 0.3, color: rule });
  };

  newPage(true);
  if (rows.length === 0) {
    page.drawText(clean(x.emptyNote), { x: M + pad, y: y - 16, size: 9, font, color: muted });
    y -= 24;
  }
  rows.forEach((r, i) => drawRow(r, i, false));
  if (x.totals && rows.length) drawRow(x.totals, 0, true);
  if (x.cutNote) {
    if (y - 20 < M + 20) newPage(false);
    page.drawText(fit(x.cutNote, font, 8, usable), { x: M, y: y - 14, size: 8, font, color: muted });
  }

  pages.forEach((p, i) => {
    const label = clean(`${x.pageLabel} ${i + 1} / ${pages.length}`);
    p.drawText(fit(x.footer, font, 7.5, usable - 80), { x: M, y: M - 14, size: 7.5, font, color: muted });
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 7.5), y: M - 14, size: 7.5, font, color: muted });
  });
  return pdf.save();
}
