import type { Cell, Col, Row } from "@/lib/reports/defs";

/**
 * A small Excel (.xlsx) writer for reports: one sheet with a title block, a header row with filter
 * buttons, the rows (numbers stay numbers, dates stay dates) and a totals row. No extra library:
 * an .xlsx file is a zip of a few XML files, written here without compression.
 * Text is always written as text (never as a formula), so a value like "=SUM(...)" cannot run.
 */

export type SheetInput = {
  sheetName: string;
  title: string;
  lines: string[];
  headers: string[];
  cols: Col[];
  rows: Row[];
  totals: Row | null;
  totalLabel: string;
};

// Styles (index into cellXfs below).
const S = { title: 1, note: 2, head: 3, money: 4, int: 5, qty: 6, pct: 7, date: 8, dt: 9, tText: 10, tMoney: 11, tInt: 12, tQty: 13, tPct: 14 } as const;

function esc(s: string) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const EPOCH = Date.UTC(1899, 11, 30);

function dateSerial(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - EPOCH) / 864e5;
}

/** A timestamp as an Excel date-time in Tanzania time. */
function dateTimeSerial(ts: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - EPOCH) / 864e5;
}

function str(ref: string, v: string, style = 0) {
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}
function num(ref: string, v: number, style: number) {
  return Number.isFinite(v) ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : "";
}

function cell(ref: string, c: Col, v: Cell, totals: boolean): string {
  if (v === null || v === undefined || v === "") return "";
  switch (c.type) {
    case "money":
      return num(ref, Number(v), totals ? S.tMoney : S.money);
    case "int":
      return num(ref, Number(v), totals ? S.tInt : S.int);
    case "qty":
      return num(ref, Number(v), Number.isInteger(Number(v)) ? (totals ? S.tInt : S.int) : totals ? S.tQty : S.qty);
    case "percent":
      return num(ref, Number(v) / 100, totals ? S.tPct : S.pct);
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? num(ref, dateSerial(String(v)), S.date) : str(ref, String(v));
    case "datetime":
      return num(ref, dateTimeSerial(String(v)), S.dt);
    default:
      return str(ref, String(v), totals ? S.tText : 0);
  }
}

function sheetXml(x: SheetInput, display: (c: Col, v: Cell) => string) {
  const out: string[] = [];
  let r = 0;
  const row = (cells: string, extra = "") => {
    r += 1;
    out.push(`<row r="${r}"${extra}>${cells}</row>`);
  };
  row(str(`A1`, x.title, S.title), ' ht="22" customHeight="1"');
  for (const l of x.lines) row(str(`A${r + 1}`, l, S.note));
  row("");
  const headRow = r + 1;
  row(x.headers.map((h, i) => str(`${colName(i)}${headRow}`, h, S.head)).join(""));
  for (const data of x.rows) {
    const rr = r + 1;
    row(x.cols.map((c, i) => cell(`${colName(i)}${rr}`, c, data[c.key], false)).join(""));
  }
  const lastData = r;
  if (x.totals) {
    const rr = r + 1;
    row(
      x.cols
        .map((c, i) => {
          const ref = `${colName(i)}${rr}`;
          if (i === 0 && !(c.key in x.totals!)) return str(ref, x.totalLabel, S.tText);
          return c.key in x.totals! ? cell(ref, c, x.totals![c.key], true) : str(ref, "", S.tText);
        })
        .join(""),
    );
  }

  // Column widths from the longest value shown (capped).
  const widths = x.cols.map((c, i) => {
    let w = x.headers[i].length;
    for (const d of x.rows.slice(0, 2000)) w = Math.max(w, display(c, d[c.key]).length);
    return Math.min(60, Math.max(8, w + 2));
  });
  const last = colName(Math.max(0, x.cols.length - 1));
  const filterRef = `A${headRow}:${last}${Math.max(headRow, lastData)}`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${out.join("")}</sheetData>` +
    `<autoFilter ref="${filterRef}"/>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`;
  return { xml, filterRef };
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.000"/><numFmt numFmtId="165" formatCode="0.0%"/>` +
  `<numFmt numFmtId="166" formatCode="dd mmm yyyy"/><numFmt numFmtId="167" formatCode="dd mmm yyyy hh:mm"/></numFmts>` +
  `<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font>` +
  `<font><sz val="10"/><color rgb="FF5B6670"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FF8A99A8"/></bottom><diagonal/></border>` +
  `<border><left/><right/><top style="thin"><color rgb="FF14212E"/></top><bottom style="double"><color rgb="FF14212E"/></bottom><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="15">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>` +
  `<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>` +
  `<xf numFmtId="4" fontId="3" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` +
  `<xf numFmtId="3" fontId="3" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` +
  `<xf numFmtId="164" fontId="3" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` +
  `<xf numFmtId="165" fontId="3" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function safeSheetName(s: string) {
  return s.replace(/[\[\]:*?/\\']/g, " ").trim().slice(0, 31) || "Report";
}

export function buildXlsx(x: SheetInput, display: (c: Col, v: Cell) => string): Uint8Array {
  const name = safeSheetName(x.sheetName);
  const { xml, filterRef } = sheetXml(x, display);
  const abs = filterRef.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${esc(name)}'!${abs}</definedName></definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", xml],
  ];
  return zip(files.map(([n, s]) => [n, new TextEncoder().encode(s)]));
}

// --- A minimal zip writer (stored, no compression) -----------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, data] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
