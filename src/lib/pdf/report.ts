import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { clean, type DocCompany } from "./document";

/**
 * A plain report writer on top of pdf-lib, for the LPO financing pack and the catalogue PDF:
 * letterhead, headings, paragraphs, label/value rows, tables, pictures and other PDFs added at the end.
 * Same look as the other documents (company colours, logo, A4, Helvetica).
 */

export const A4 = { w: 595.28, h: 841.89 };
const M = 40;
const BOTTOM = 64;

type Logo = { bytes: Uint8Array; type: "png" | "jpg" } | null;
type TextOpt = { size?: number; bold?: boolean; color?: RGB };
export type Col = { label: string; width: number; align?: "left" | "right" };

function hex(c: string | null | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) <= width) line = cand;
      else {
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

export class Report {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  /** Pages this writer made (footers go on these only). */
  own: PDFPage[] = [];
  y = 0;
  brand: RGB = rgb(0.11, 0.3, 0.61);
  dark: RGB = rgb(0.07, 0.23, 0.48);
  ink = rgb(0.08, 0.13, 0.18);
  muted = rgb(0.36, 0.4, 0.46);
  rule = rgb(0.85, 0.88, 0.91);
  zebra = rgb(0.965, 0.973, 0.984);
  logo: PDFImage | null = null;
  readonly width = A4.w - 2 * M;
  readonly left = M;

  constructor(
    readonly company: DocCompany,
    readonly runningTitle: string,
  ) {}

  static async create(company: DocCompany, logo: Logo, runningTitle: string, docTitle: string): Promise<Report> {
    const r = new Report(company, runningTitle);
    r.doc = await PDFDocument.create();
    r.doc.setTitle(clean(docTitle));
    r.doc.setAuthor(clean(company.name));
    r.doc.setCreator("LeMoSp");
    r.font = await r.doc.embedFont(StandardFonts.Helvetica);
    r.bold = await r.doc.embedFont(StandardFonts.HelveticaBold);
    r.brand = hex(company.primary_color, r.brand);
    r.dark = hex(company.accent_color, r.dark);
    if (logo) {
      try {
        r.logo = logo.type === "png" ? await r.doc.embedPng(logo.bytes) : await r.doc.embedJpg(logo.bytes);
      } catch {
        r.logo = null;
      }
    }
    return r;
  }

  text(s: string, x: number, y: number, o: TextOpt = {}) {
    this.page.drawText(clean(s), { x, y, size: o.size ?? 9.5, font: o.bold ? this.bold : this.font, color: o.color ?? this.ink });
  }

  right(s: string, xr: number, y: number, o: TextOpt = {}) {
    const f = o.bold ? this.bold : this.font;
    this.text(s, xr - f.widthOfTextAtSize(clean(s), o.size ?? 9.5), y, o);
  }

  /** A new page; `letterhead` draws the full company header (first page of a section). */
  newPage(letterhead = false) {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.own.push(this.page);
    this.page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: this.brand });
    this.y = A4.h - 40;
    if (!letterhead) {
      this.text(`${this.company.name}  -  ${this.runningTitle}`, M, this.y, { size: 8.5, color: this.muted });
      this.y -= 26;
      return;
    }
    let x = M;
    if (this.logo) {
      const h = 50;
      const w = Math.min((this.logo.width / this.logo.height) * h, 140);
      const hh = (w / this.logo.width) * this.logo.height;
      this.page.drawImage(this.logo, { x: M, y: this.y - hh + 14, width: w, height: hh });
      x = M + w + 12;
    }
    this.text(this.company.name, x, this.y, { bold: true, size: 15, color: this.dark });
    let hy = this.y - 15;
    const c = this.company;
    for (const l of [
      c.legal_name && c.legal_name !== c.name ? c.legal_name : null,
      c.address,
      [c.phone, c.email].filter(Boolean).join("  |  "),
      c.website,
      [c.tin ? `TIN: ${c.tin}` : null, c.vrn ? `VRN: ${c.vrn}` : null].filter(Boolean).join("   "),
    ]) {
      if (!l) continue;
      for (const w of wrapText(l, this.font, 8.5, A4.w - M - x)) {
        this.text(w, x, hy, { size: 8.5, color: this.muted });
        hy -= 11;
      }
    }
    this.y = Math.min(hy, this.y - 56) - 10;
    this.page.drawLine({ start: { x: M, y: this.y + 4 }, end: { x: A4.w - M, y: this.y + 4 }, thickness: 0.6, color: this.rule });
    this.y -= 14;
  }

  need(h: number) {
    if (this.y - h < BOTTOM) this.newPage(false);
  }

  space(h = 8) {
    this.y -= h;
  }

  title(s: string) {
    this.need(40);
    this.text(s, M, this.y, { bold: true, size: 16, color: this.brand });
    this.y -= 24;
  }

  heading(s: string) {
    this.need(46);
    this.y -= 4;
    this.text(s.toUpperCase(), M, this.y, { bold: true, size: 9, color: this.brand });
    this.page.drawLine({ start: { x: M, y: this.y - 4 }, end: { x: A4.w - M, y: this.y - 4 }, thickness: 0.5, color: this.rule });
    this.y -= 17;
  }

  para(s: string | null | undefined, o: TextOpt & { indent?: number; gap?: number } = {}) {
    if (!s) return;
    const size = o.size ?? 9.5;
    const lh = size * 1.35;
    const x = M + (o.indent ?? 0);
    for (const line of wrapText(s, o.bold ? this.bold : this.font, size, this.width - (o.indent ?? 0))) {
      this.need(lh);
      this.text(line, x, this.y, { ...o, size });
      this.y -= lh;
    }
    this.y -= o.gap ?? 5;
  }

  /** Label: value rows in two columns of text (label muted). */
  rows(items: [string, string | null | undefined][], labelWidth = 170) {
    for (const [k, v] of items) {
      if (v == null || v === "") continue;
      const lines = wrapText(v, this.font, 9.5, this.width - labelWidth);
      this.need(lines.length * 12.5 + 2);
      this.text(k, M, this.y, { color: this.muted });
      lines.forEach((l, i) => this.text(l, M + labelWidth, this.y - i * 12.5));
      this.y -= lines.length * 12.5 + 2;
    }
    this.y -= 4;
  }

  table(cols: Col[], body: string[][], o: { totalRow?: boolean } = {}) {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = this.width / total;
    const xs: number[] = [];
    let x = M;
    for (const c of cols) {
      xs.push(x);
      x += c.width * scale;
    }
    const header = () => {
      this.need(40);
      this.page.drawRectangle({ x: M, y: this.y - 6, width: this.width, height: 19, color: this.dark });
      cols.forEach((c, i) => {
        const o2 = { bold: true, size: 8, color: rgb(1, 1, 1) };
        if (c.align === "right") this.right(c.label, xs[i] + c.width * scale - 4, this.y, o2);
        else this.text(c.label, xs[i] + 4, this.y, o2);
      });
      this.y -= 20;
    };
    header();
    body.forEach((row, r) => {
      const cells = row.map((v, i) => wrapText(v ?? "", this.font, 8.5, cols[i].width * scale - 8));
      const h = Math.max(1, ...cells.map((c) => c.length)) * 11 + 5;
      const last = o.totalRow && r === body.length - 1;
      if (this.y - h < BOTTOM) {
        this.newPage(false);
        header();
      }
      if (r % 2 === 1 && !last) this.page.drawRectangle({ x: M, y: this.y - h + 9, width: this.width, height: h, color: this.zebra });
      if (last) this.page.drawLine({ start: { x: M, y: this.y + 9 }, end: { x: A4.w - M, y: this.y + 9 }, thickness: 0.7, color: this.muted });
      cells.forEach((lines, i) =>
        lines.forEach((l, k) => {
          const yy = this.y - k * 11;
          const o2 = { size: 8.5, bold: last };
          if (cols[i].align === "right") this.right(l, xs[i] + cols[i].width * scale - 4, yy, o2);
          else this.text(l, xs[i] + 4, yy, o2);
        }),
      );
      this.y -= h;
    });
    this.y -= 8;
  }

  /** A QR code from a module matrix, `size` points wide, at (x, top). */
  qr(modules: boolean[][], x: number, top: number, size: number) {
    const n = modules.length;
    const cell = size / n;
    this.page.drawRectangle({ x: x - cell * 2, y: top - size - cell * 2, width: size + cell * 4, height: size + cell * 4, color: rgb(1, 1, 1) });
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (modules[r][c]) this.page.drawRectangle({ x: x + c * cell, y: top - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
  }

  /** "Page i of n" and the running title on the writer's own pages (not on attached documents). */
  footers(label: string) {
    const all = this.doc.getPages();
    const total = all.length;
    for (const p of this.own) {
      const i = all.indexOf(p) + 1;
      p.drawLine({ start: { x: M, y: 46 }, end: { x: A4.w - M, y: 46 }, thickness: 0.5, color: this.rule });
      p.drawText(clean(label), { x: M, y: 34, size: 7.5, font: this.font, color: this.muted });
      const t = `Page ${i} of ${total}`;
      p.drawText(t, { x: A4.w - M - this.font.widthOfTextAtSize(t, 7.5), y: 34, size: 7.5, font: this.font, color: this.muted });
    }
  }
}

export type AttachResult = { pages: number; first: number | null; error?: string };

/**
 * Adds a stored file to the end: a PDF (all its pages, at most `maxPages`) or a photo (on its own A4
 * page with a caption). Encrypted or broken PDFs are skipped with the reason.
 */
export async function attachFile(r: Report, bytes: Uint8Array, type: string, caption: string, maxPages = 30): Promise<AttachResult> {
  const before = r.doc.getPageCount();
  try {
    if (type === "application/pdf") {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
      const idx = src.getPageIndices().slice(0, maxPages);
      const copied = await r.doc.copyPages(src, idx);
      copied.forEach((p) => r.doc.addPage(p));
      return { pages: copied.length, first: before + 1 };
    }
    if (type === "image/png" || type === "image/jpeg" || type === "image/jpg") {
      const img = type === "image/png" ? await r.doc.embedPng(bytes) : await r.doc.embedJpg(bytes);
      const page = r.doc.addPage([A4.w, A4.h]);
      page.drawText(clean(caption).slice(0, 110), { x: M, y: A4.h - 40, size: 10, font: r.bold, color: r.ink });
      const maxW = A4.w - 2 * M;
      const maxH = A4.h - 110;
      const s = Math.min(maxW / img.width, maxH / img.height, 1.5);
      page.drawImage(img, { x: (A4.w - img.width * s) / 2, y: A4.h - 60 - img.height * s, width: img.width * s, height: img.height * s });
      return { pages: 1, first: before + 1 };
    }
    return { pages: 0, first: null, error: "Only PDF, PNG and JPG files can be added" };
  } catch (e) {
    const msg = String((e as Error)?.message ?? "");
    return { pages: 0, first: null, error: /encrypt/i.test(msg) ? "The PDF is password protected" : "The file could not be read" };
  }
}

/** Adds a whole generated PDF (quotation, statement) to the end. */
export async function attachPdf(r: Report, bytes: Uint8Array): Promise<AttachResult> {
  return attachFile(r, bytes, "application/pdf", "", 60);
}
