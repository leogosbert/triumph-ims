import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Playbook, PlaybookExample, PlaybookScenario, Tone } from "@/lib/playbooks/types";
import { clean } from "@/lib/pdf/document";

/**
 * A playbook as a printable A4 PDF: cover, contents with page numbers, then every chapter and step
 * with its actions, sample record, "If this happens" scenarios and tips. Same text as the screen
 * (already translated), drawn with the standard PDF fonts.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 48;
const W = A4.w - 2 * M;
const TOP = A4.h - 62;
const BOTTOM = 58;

const NAVY = rgb(0.043, 0.122, 0.227);
const INK = rgb(0.063, 0.129, 0.231);
const MUTED = rgb(0.36, 0.42, 0.51);
const LINE = rgb(0.85, 0.88, 0.92);
const TEAL = rgb(0.078, 0.722, 0.651);
const SOFT = rgb(0.957, 0.965, 0.98);

const TONES: Record<Tone, RGB> = {
  info: rgb(0.145, 0.388, 0.922),
  ok: rgb(0.086, 0.639, 0.29),
  warn: rgb(0.851, 0.467, 0.024),
  bad: rgb(0.863, 0.149, 0.149),
};

function hex(c: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return rgb(0.11, 0.3, 0.61);
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= width) line = t;
      else {
        if (line) out.push(line);
        // A single word wider than the line: cut it.
        let rest = w;
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          out.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

export type PlaybookPdfLabels = {
  playbook: string;
  contents: string;
  chapter: string;
  stepByStep: string;
  where: string;
  who: string;
  example: string;
  ifThisHappens: string;
  whatToDo: string;
  tip: string;
  page: string;
  forWho: string;
  minutes: string;
  chapters: string;
  steps: string;
  scenarios: string;
  footer: string;
};

export async function playbookPdf(
  pb: Playbook,
  L: PlaybookPdfLabels,
  stats: { steps: number; scenarios: number },
  /** For a company's own copy: "Made for <name>" and a line on how it was fitted. */
  madeFor?: { line: string; note: string },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`${pb.title} - LeMoSp`));
  pdf.setAuthor("LeMoSp");
  pdf.setSubject(clean(pb.tagline));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const accent = hex(pb.color);

  // ---------- Cover ----------
  const cover = pdf.addPage([A4.w, A4.h]);
  cover.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: NAVY });
  cover.drawRectangle({ x: 0, y: A4.h - 300, width: A4.w, height: 300, color: accent, opacity: 0.9 });
  // A small skyline, as in the app.
  const sky: [number, number, number][] = [
    [0, 60, 120], [64, 40, 170], [108, 70, 95], [182, 36, 210], [222, 60, 140], [286, 90, 75], [380, 44, 190],
    [428, 66, 130], [498, 40, 230], [542, 54, 105],
  ];
  for (const [x, w, h] of sky) cover.drawRectangle({ x, y: 0, width: w, height: h, color: rgb(1, 1, 1), opacity: 0.06 });
  cover.drawText("LeMoSp", { x: M, y: A4.h - 70, size: 20, font: bold, color: rgb(1, 1, 1) });
  cover.drawText(clean(L.playbook.toUpperCase()), { x: M, y: A4.h - 92, size: 10, font: bold, color: rgb(1, 1, 1), opacity: 0.8 });
  let y = A4.h - 170;
  for (const l of wrap(pb.title, bold, 30, W)) {
    cover.drawText(l, { x: M, y, size: 30, font: bold, color: rgb(1, 1, 1) });
    y -= 36;
  }
  y = A4.h - 340;
  for (const l of wrap(pb.tagline, font, 14, W)) {
    cover.drawText(l, { x: M, y, size: 14, font, color: rgb(0.9, 0.93, 0.97) });
    y -= 20;
  }
  y -= 18;
  cover.drawRectangle({ x: M, y: y - 4, width: 60, height: 3, color: TEAL });
  y -= 30;
  if (madeFor) {
    for (const l of wrap(madeFor.line, bold, 14, W)) {
      cover.drawText(l, { x: M, y, size: 14, font: bold, color: rgb(1, 1, 1) });
      y -= 20;
    }
    for (const l of wrap(madeFor.note, font, 10, W)) {
      cover.drawText(l, { x: M, y, size: 10, font, color: rgb(0.75, 0.8, 0.88) });
      y -= 14;
    }
  } else {
    for (const l of wrap(`${L.forWho} ${pb.audience}`, font, 11, W)) {
      cover.drawText(l, { x: M, y, size: 11, font, color: rgb(0.75, 0.8, 0.88) });
      y -= 16;
    }
  }
  y -= 22;
  const facts: [string, string][] = [
    [String(pb.chapters.length), L.chapters],
    [String(stats.steps), L.steps],
    [String(stats.scenarios), L.scenarios],
    [`~${pb.minutes}`, L.minutes],
  ];
  facts.forEach(([n, label], i) => {
    const x = M + i * (W / 4);
    cover.drawText(n, { x, y, size: 26, font: bold, color: rgb(1, 1, 1) });
    cover.drawText(clean(label), { x, y: y - 16, size: 9, font, color: rgb(0.75, 0.8, 0.88) });
  });
  cover.drawText(clean(L.footer), { x: M, y: 40, size: 9, font, color: rgb(0.6, 0.67, 0.77) });

  // ---------- Body ----------
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  y = TOP;
  const chapterPages: number[] = [];
  const pageNo = () => pdf.getPageCount(); // contents page is inserted later (+1)

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = TOP;
  };
  const need = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };
  const text = (s: string, o: { size?: number; f?: PDFFont; color?: RGB; indent?: number; gap?: number; width?: number } = {}) => {
    const size = o.size ?? 10.5;
    const f = o.f ?? font;
    const lh = size * 1.42;
    for (const l of wrap(s, f, size, (o.width ?? W) - (o.indent ?? 0))) {
      need(lh);
      page.drawText(l, { x: M + (o.indent ?? 0), y: y - size, size, font: f, color: o.color ?? INK });
      y -= lh;
    }
    y -= o.gap ?? 4;
  };
  const label = (s: string, color: RGB) => {
    need(20);
    page.drawText(clean(s.toUpperCase()), { x: M, y: y - 9, size: 8.5, font: bold, color });
    y -= 16;
  };

  const exampleBox = (ex: PlaybookExample) => {
    const tone = TONES[ex.tone];
    const rows = ex.lines.map(([k, v]) => ({ k: wrap(k, font, 9.5, W * 0.48), v: wrap(v, bold, 9.5, W * 0.42) }));
    const h = 44 + rows.reduce((n, r) => n + Math.max(r.k.length, r.v.length) * 13 + 6, 0);
    need(h + 10);
    const top = y;
    page.drawRectangle({ x: M, y: top - h, width: W, height: h, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 1 });
    page.drawRectangle({ x: M, y: top - 4, width: W, height: 4, color: tone });
    page.drawText(clean(`${L.example}: ${ex.kind}`.toUpperCase()), { x: M + 12, y: top - 20, size: 8, font: bold, color: tone });
    page.drawText(clean(ex.title), { x: M + 12, y: top - 34, size: 11, font: bold, color: INK });
    if (ex.stamp) {
      const s = clean(ex.stamp.toUpperCase());
      const sw = bold.widthOfTextAtSize(s, 9) + 14;
      page.drawRectangle({ x: M + W - sw - 12, y: top - 34, width: sw, height: 18, borderColor: tone, borderWidth: 1.6, color: rgb(1, 1, 1) });
      page.drawText(s, { x: M + W - sw - 5, y: top - 28, size: 9, font: bold, color: tone });
    }
    let ry = top - 48;
    rows.forEach((r, i) => {
      const lines = Math.max(r.k.length, r.v.length);
      const rh = lines * 13 + 6;
      if (i === ex.mark) page.drawRectangle({ x: M + 6, y: ry - rh + 4, width: W - 12, height: rh, color: SOFT });
      r.k.forEach((l, j) => page.drawText(l, { x: M + 12, y: ry - 9 - j * 13, size: 9.5, font, color: MUTED }));
      r.v.forEach((l, j) => {
        const w = bold.widthOfTextAtSize(l, 9.5);
        page.drawText(l, { x: M + W - 12 - w, y: ry - 9 - j * 13, size: 9.5, font: bold, color: INK });
      });
      ry -= rh;
      if (i < rows.length - 1) page.drawLine({ start: { x: M + 12, y: ry + 3 }, end: { x: M + W - 12, y: ry + 3 }, thickness: 0.5, color: LINE });
    });
    y = top - h - 12;
  };

  const scenarioBox = (sc: PlaybookScenario) => {
    const tone = TONES[sc.tone ?? "warn"];
    const inner = W - 24;
    const titleL = wrap(sc.title, bold, 10.5, inner);
    const probL = wrap(sc.problem, oblique, 9.5, inner);
    const fixL = sc.fix.map((f) => wrap(f, font, 9.5, inner - 16));
    const h = 26 + titleL.length * 14 + probL.length * 13 + 8 + fixL.reduce((n, l) => n + l.length * 13 + 3, 0) + 8;
    if (h < TOP - BOTTOM) need(h + 8);
    const top = y;
    page.drawRectangle({ x: M, y: top - h, width: W, height: h, color: SOFT });
    page.drawRectangle({ x: M, y: top - h, width: 3, height: h, color: tone });
    page.drawText(clean(L.ifThisHappens.toUpperCase()), { x: M + 12, y: top - 14, size: 8, font: bold, color: tone });
    let sy = top - 28;
    titleL.forEach((l) => {
      page.drawText(l, { x: M + 12, y: sy - 1, size: 10.5, font: bold, color: INK });
      sy -= 14;
    });
    probL.forEach((l) => {
      page.drawText(l, { x: M + 12, y: sy - 1, size: 9.5, font: oblique, color: MUTED });
      sy -= 13;
    });
    sy -= 6;
    fixL.forEach((ls, i) => {
      page.drawText(`${i + 1}.`, { x: M + 12, y: sy - 1, size: 9.5, font: bold, color: tone });
      ls.forEach((l) => {
        page.drawText(l, { x: M + 28, y: sy - 1, size: 9.5, font, color: INK });
        sy -= 13;
      });
      sy -= 3;
    });
    y = top - h - 10;
  };

  const banded = new Set<unknown>();
  pb.chapters.forEach((ch, ci) => {
    // Each chapter starts on a new page with a coloured band.
    if (ci > 0 || y < TOP) newPage();
    chapterPages.push(pageNo());
    banded.add(page);
    page.drawRectangle({ x: 0, y: A4.h - 150, width: A4.w, height: 150, color: accent });
    page.drawText(clean(`${L.chapter} ${ci + 1}`.toUpperCase()), { x: M, y: A4.h - 70, size: 10, font: bold, color: rgb(1, 1, 1), opacity: 0.85 });
    let cy = A4.h - 98;
    for (const l of wrap(ch.title, bold, 22, W)) {
      page.drawText(l, { x: M, y: cy, size: 22, font: bold, color: rgb(1, 1, 1) });
      cy -= 26;
    }
    y = A4.h - 176;
    text(ch.intro, { size: 11.5, color: MUTED, gap: 14 });

    ch.steps.forEach((st, si) => {
      need(70);
      page.drawCircle({ x: M + 11, y: y - 11, size: 11, color: accent });
      const n = `${si + 1}`;
      page.drawText(n, { x: M + 11 - bold.widthOfTextAtSize(n, 10) / 2, y: y - 14.5, size: 10, font: bold, color: rgb(1, 1, 1) });
      const tl = wrap(st.title, bold, 14, W - 32);
      tl.forEach((l, i) => page.drawText(l, { x: M + 30, y: y - 16 - i * 18, size: 14, font: bold, color: INK }));
      y -= 10 + tl.length * 18 + 6;
      text(st.body, { gap: 6 });
      if (st.who) text(`${L.who} ${st.who}`, { size: 9.5, color: MUTED, f: oblique, gap: 6 });
      if (st.do?.length) {
        label(L.stepByStep, accent);
        st.do.forEach((d, i) => {
          const ls = wrap(d, font, 10.5, W - 22);
          need(ls.length * 15 + 2);
          page.drawText(`${i + 1}.`, { x: M + 2, y: y - 10.5, size: 10.5, font: bold, color: accent });
          ls.forEach((l) => {
            page.drawText(l, { x: M + 22, y: y - 10.5, size: 10.5, font, color: INK });
            y -= 15;
          });
          y -= 3;
        });
        y -= 4;
      }
      if (st.where?.length) text(`${L.where} ${st.where.join(" > ")}`, { size: 9.5, color: MUTED, gap: 8 });
      if (st.example) exampleBox(st.example);
      st.scenarios?.forEach(scenarioBox);
      if (st.tip) {
        const ls = wrap(`${L.tip}: ${st.tip}`, font, 9.5, W - 24);
        const h = ls.length * 13 + 14;
        need(h + 6);
        page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: rgb(1, 0.973, 0.89) });
        ls.forEach((l, i) => page.drawText(l, { x: M + 12, y: y - 17 - i * 13, size: 9.5, font, color: rgb(0.47, 0.33, 0.04) }));
        y -= h + 10;
      }
      y -= 10;
      if (si < ch.steps.length - 1) {
        need(10);
        page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + W, y: y + 4 }, thickness: 0.6, color: LINE });
        y -= 8;
      }
    });
  });

  // ---------- Contents (inserted as page 2) ----------
  const toc = pdf.insertPage(1, [A4.w, A4.h]);
  toc.drawText(clean(L.contents), { x: M, y: A4.h - 90, size: 24, font: bold, color: INK });
  toc.drawRectangle({ x: M, y: A4.h - 104, width: 50, height: 3, color: TEAL });
  let ty = A4.h - 140;
  pb.chapters.forEach((ch, ci) => {
    const pn = String(chapterPages[ci] + 1);
    const ls = wrap(`${ci + 1}.  ${ch.title}`, bold, 12, W - 60);
    ls.forEach((l, i) => toc.drawText(l, { x: M, y: ty - i * 16, size: 12, font: bold, color: INK }));
    toc.drawText(pn, { x: M + W - bold.widthOfTextAtSize(pn, 12), y: ty, size: 12, font: bold, color: accent });
    ty -= ls.length * 16 + 2;
    const sl = wrap(ch.steps.map((s) => s.title).join("  ·  "), font, 9, W - 30);
    sl.slice(0, 4).forEach((l) => {
      toc.drawText(l, { x: M + 18, y: ty, size: 9, font, color: MUTED });
      ty -= 12;
    });
    ty -= 12;
  });

  // ---------- Header and footer on every page after the cover ----------
  const pages = pdf.getPages();
  const head = clean(`LeMoSp  ·  ${pb.title}`);
  pages.forEach((p, i) => {
    if (i === 0) return;
    // Chapter pages open with the coloured band, which takes the place of the header.
    if (!banded.has(p)) {
      p.drawText(head.length > 90 ? `${head.slice(0, 87)}...` : head, { x: M, y: A4.h - 32, size: 8.5, font, color: MUTED });
      p.drawLine({ start: { x: M, y: A4.h - 40 }, end: { x: A4.w - M, y: A4.h - 40 }, thickness: 0.5, color: LINE });
    }
    p.drawLine({ start: { x: M, y: 40 }, end: { x: A4.w - M, y: 40 }, thickness: 0.5, color: LINE });
    p.drawText(clean(L.footer), { x: M, y: 26, size: 8, font, color: MUTED });
    const n = clean(`${L.page} ${i + 1} / ${pages.length}`);
    p.drawText(n, { x: A4.w - M - font.widthOfTextAtSize(n, 8), y: 26, size: 8, font, color: MUTED });
  });

  return pdf.save();
}
