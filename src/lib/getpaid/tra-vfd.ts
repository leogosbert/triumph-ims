import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

/**
 * TRA Virtual Fiscal Device (VFD) API adapter: registration, token, receipt / invoice posting and the
 * daily Z report. Server only: the private key never leaves the server.
 *
 * NOT VERIFIED AGAINST A REAL TRA SERVICE. The message layout below follows TRA's "VFD API" integration
 * specification as we understand it (XML <EFDMS> envelope, the signed <REGDATA>, <RCT> and <ZREPORT>
 * parts signed with SHA1withRSA using the key of the certificate TRA issues, Cert-Serial / Routing-Key
 * headers, an OAuth-style token). Test on TRA's test service (TRA_VFD_ENV=test) and compare with the
 * specification TRA sends you before switching to live.
 *
 * Settings (Netlify → Site configuration → Environment variables), all secret:
 *   TRA_VFD_PRIVATE_KEY     the private key of the TRA certificate, PEM (or the PEM in base64).
 *                           From the .pfx TRA gives you:  openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem
 *   TRA_VFD_TIN             the TIN the certificate belongs to (9 digits). Only that company can post.
 *   TRA_VFD_ENV             "test" (default) or "live"
 *   TRA_VFD_BASE_URL        optional: overrides the address (test https://vfdtest.tra.go.tz, live https://vfd.tra.go.tz)
 *   TRA_VFD_TRA_PUBLIC_CERT optional: TRA's public certificate (PEM) to check the signature of TRA's answers
 * Per company, in the app (Getting paid → TRA receipts): the TIN, the certificate serial and the VFD serial.
 */

export type VfdEnv = { key: KeyObject; tin: string; env: "test" | "live"; base: string; traKey: KeyObject | null };

export const VFD_BASE = { test: "https://vfdtest.tra.go.tz", live: "https://vfd.tra.go.tz" } as const;

function pem(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    return decoded.includes("-----BEGIN") ? decoded : null;
  } catch {
    return null;
  }
}

/** The server's VFD settings, or null when they are not (all) set. Never returns the key text. */
export function vfdEnv(e: NodeJS.ProcessEnv = process.env): VfdEnv | null {
  const keyPem = pem(e.TRA_VFD_PRIVATE_KEY);
  const tin = (e.TRA_VFD_TIN ?? "").replace(/\D/g, "");
  if (!keyPem || !/^\d{9}$/.test(tin)) return null;
  let key: KeyObject;
  try {
    key = createPrivateKey(keyPem);
  } catch {
    return null;
  }
  const env = e.TRA_VFD_ENV === "live" ? "live" : "test";
  let traKey: KeyObject | null = null;
  const tra = pem(e.TRA_VFD_TRA_PUBLIC_CERT);
  if (tra) {
    try {
      traKey = createPublicKey(tra);
    } catch {
      traKey = null;
    }
  }
  return { key, tin, env, base: (e.TRA_VFD_BASE_URL?.trim() || VFD_BASE[env]).replace(/\/$/, ""), traKey };
}

/** Is VFD set up on this server (without opening the key)? */
export function vfdConfigured(e: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(pem(e.TRA_VFD_PRIVATE_KEY) && /^\d{9}$/.test((e.TRA_VFD_TIN ?? "").replace(/\D/g, "")));
}

export function xmlEscape(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** <TAG>value</TAG> with the value escaped. */
const el = (tag: string, value: string | number | null | undefined) => `<${tag}>${xmlEscape(value)}</${tag}>`;

const money = (n: number) => (Math.round(Number(n) * 100) / 100).toFixed(2);

/** SHA1withRSA signature of the exact XML text, in base64 (how TRA signs and checks <EFDMSSIGNATURE>). */
export function signVfd(xml: string, key: KeyObject): string {
  return sign("RSA-SHA1", Buffer.from(xml, "utf8"), key).toString("base64");
}

export function verifyVfd(xml: string, signatureB64: string, publicKey: KeyObject): boolean {
  try {
    return verify("RSA-SHA1", Buffer.from(xml, "utf8"), publicKey, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** The signed envelope TRA expects: <?xml?><EFDMS>{part}<EFDMSSIGNATURE>…</EFDMSSIGNATURE></EFDMS>. */
export function envelope(part: string, key: KeyObject): string {
  return `<?xml version="1.0" encoding="UTF-8"?><EFDMS>${part}<EFDMSSIGNATURE>${signVfd(part, key)}</EFDMSSIGNATURE></EFDMS>`;
}

/** Text of the first <TAG>…</TAG> (unescaped), or null. */
export function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------
export function registrationPart(tin: string, certKey: string): string {
  return `<REGDATA>${el("TIN", tin)}${el("CERTKEY", certKey)}</REGDATA>`;
}

export type VfdRegistration = {
  ackCode: string | null;
  ackMessage: string | null;
  reg_id: string | null;
  serial: string | null;
  uin: string | null;
  tin: string | null;
  vrn: string | null;
  receipt_code: string | null;
  routing_key: string | null;
  tax_office: string | null;
  username: string | null;
  password: string | null;
  token_path: string | null;
  gc: number | null;
};

export function parseRegistration(xml: string): VfdRegistration {
  const gc = xmlValue(xml, "GC");
  return {
    ackCode: xmlValue(xml, "ACKCODE"),
    ackMessage: xmlValue(xml, "ACKMSG"),
    reg_id: xmlValue(xml, "REGID"),
    serial: xmlValue(xml, "SERIAL"),
    uin: xmlValue(xml, "UIN"),
    tin: xmlValue(xml, "TIN"),
    vrn: xmlValue(xml, "VRN"),
    receipt_code: xmlValue(xml, "RECEIPTCODE"),
    routing_key: xmlValue(xml, "ROUTINGKEY"),
    tax_office: xmlValue(xml, "TAXOFFICE"),
    username: xmlValue(xml, "USERNAME"),
    password: xmlValue(xml, "PASSWORD"),
    token_path: xmlValue(xml, "TOKENPATH"),
    gc: gc && /^\d+$/.test(gc) ? Number(gc) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------------------------
export type ReceiptJob = {
  receipt: { id: string; gc: number; dc: number; z_number: string; verification_code: string; receipt_at: string };
  settings: { tin: string | null; reg_id: string | null; vfd_serial: string | null; zero_tax_code: number; receipt_code: string | null };
  invoice: { number: string; vat_rate: number; subtotal: number; vat_amount: number; total: number; discount: number };
  client: { name: string; tin: string | null; phone: string | null };
  lines: { id: number; desc: string; qty: number; amount: number }[];
};

/** TRA tax codes: 1 = A (standard VAT), 2 = B (special rate), 3 = C (zero rated), 4 = D (special relief), 5 = E (exempt). */
export const TAX_LETTER: Record<number, string> = { 1: "A", 2: "B", 3: "C", 4: "D", 5: "E" };

/** Date and time of a moment in Tanzania: ["2026-10-25", "10:49:31"]. */
export function tzDateTime(iso: string): [string, string] {
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  const s = d.toISOString();
  return [s.slice(0, 10), s.slice(11, 19)];
}

/** The <RCT> part of a receipt (the text that is signed). */
export function receiptPart(job: ReceiptJob): string {
  const [date, time] = tzDateTime(job.receipt.receipt_at);
  const taxCode = Number(job.invoice.vat_rate) > 0 ? 1 : job.settings.zero_tax_code || 5;
  const clientTin = (job.client.tin ?? "").replace(/\D/g, "");
  const hasTin = /^\d{9}$/.test(clientTin);
  // Line amounts include VAT; the last line takes the rounding so the lines add up to the total.
  const lines = job.lines.map((l) => ({ ...l, amount: Math.round(Number(l.amount) * 100) / 100 }));
  if (lines.length) {
    const sum = lines.reduce((t, l) => t + l.amount, 0);
    const diff = Math.round((Number(job.invoice.total) - sum) * 100) / 100;
    if (Math.abs(diff) > 0 && Math.abs(diff) < 1) lines[lines.length - 1].amount = Math.round((lines[lines.length - 1].amount + diff) * 100) / 100;
  }
  const items = lines
    .map((l) => `<ITEM>${el("ID", l.id)}${el("DESC", l.desc.slice(0, 100))}${el("QTY", Number(l.qty))}${el("TAXCODE", taxCode)}${el("AMT", money(l.amount))}</ITEM>`)
    .join("");
  return (
    "<RCT>" +
    el("DATE", date) +
    el("TIME", time) +
    el("TIN", job.settings.tin) +
    el("REGID", job.settings.reg_id) +
    el("EFDSERIAL", job.settings.vfd_serial) +
    el("CUSTIDTYPE", hasTin ? 1 : 6) +
    el("CUSTID", hasTin ? clientTin : "") +
    el("CUSTNAME", job.client.name.slice(0, 100)) +
    el("MOBILENUM", job.client.phone ?? "") +
    el("RCTNUM", job.receipt.gc) +
    el("DC", job.receipt.dc) +
    el("GC", job.receipt.gc) +
    el("ZNUM", job.receipt.z_number) +
    el("RCTVNUM", job.receipt.verification_code) +
    `<ITEMS>${items}</ITEMS>` +
    `<TOTALS>${el("TOTALTAXEXCL", money(job.invoice.subtotal))}${el("TOTALTAXINCL", money(job.invoice.total))}${el("DISCOUNT", money(0))}</TOTALS>` +
    // An invoice is a sale on credit: TRA's payment type INVOICE.
    `<PAYMENTS>${el("PMTTYPE", "INVOICE")}${el("PMTAMOUNT", money(job.invoice.total))}</PAYMENTS>` +
    `<VATTOTALS>${el("VATRATE", TAX_LETTER[taxCode])}${el("NETTAMOUNT", money(job.invoice.subtotal))}${el("TAXAMOUNT", money(job.invoice.vat_amount))}</VATTOTALS>` +
    "</RCT>"
  );
}

export type VfdAck = { ok: boolean; code: string | null; message: string | null; signatureOk: boolean | null };

/** TRA's answer: <RCTACK>/<ZACK>/<REGDATA> with <ACKCODE> 0 = accepted. */
export function parseAck(xml: string, traKey: KeyObject | null = null): VfdAck {
  const code = xmlValue(xml, "ACKCODE");
  const message = xmlValue(xml, "ACKMSG");
  let signatureOk: boolean | null = null;
  const sig = xmlValue(xml, "EFDMSSIGNATURE");
  if (traKey && sig) {
    const m = /<EFDMS>([\s\S]*)<EFDMSSIGNATURE>/i.exec(xml);
    signatureOk = m ? verifyVfd(m[1], sig, traKey) : false;
  }
  return { ok: code === "0" && signatureOk !== false, code, message, signatureOk };
}

// ---------------------------------------------------------------------------------------------
// Z report
// ---------------------------------------------------------------------------------------------
export type ZJob = {
  zreport: { id: string; z_day: string; receipts: number; total_excl: number; vat_amount: number; total_incl: number };
  settings: { tin: string | null; reg_id: string | null; vfd_serial: string | null; tax_office: string | null; registered_at: string | null; uin: string | null };
  company: { name: string; address: string | null; phone: string | null; vrn: string | null };
};

export function zReportPart(z: ZJob): string {
  const day = z.zreport.z_day.slice(0, 10);
  const vat = Number(z.zreport.vat_amount);
  const excl = Number(z.zreport.total_excl);
  const incl = Number(z.zreport.total_incl);
  const header = [z.company.name, z.company.address, z.company.phone, `TIN ${z.settings.tin ?? ""}`]
    .filter(Boolean)
    .map((l) => el("LINE", String(l).slice(0, 100)))
    .join("");
  return (
    "<ZREPORT>" +
    el("DATE", day) +
    el("TIME", "23:59:59") +
    `<HEADER>${header}</HEADER>` +
    el("VRN", z.company.vrn ?? "NOT REGISTERED") +
    el("TIN", z.settings.tin) +
    el("TAXOFFICE", z.settings.tax_office) +
    el("REGID", z.settings.reg_id) +
    el("ZNUMBER", day.replace(/-/g, "")) +
    el("EFDSERIAL", z.settings.vfd_serial) +
    el("REGISTRATIONDATE", (z.settings.registered_at ?? "").slice(0, 10)) +
    el("USER", z.settings.uin) +
    el("SIMIMSI", "WEBAPI") +
    "<TOTALS>" +
    el("DAILYTOTALAMOUNT", money(incl)) +
    el("GROSS", money(incl)) +
    el("CORRECTIONS", money(0)) +
    el("DISCOUNTS", money(0)) +
    el("SURCHARGES", money(0)) +
    el("TICKETSVOID", 0) +
    el("TICKETSVOIDTOTAL", money(0)) +
    el("TICKETSFISCAL", z.zreport.receipts) +
    el("TICKETSNONFISCAL", 0) +
    "</TOTALS>" +
    `<VATTOTALS>${el("VATRATE", vat > 0 ? "A-18.00" : "E-0.00")}${el("NETTAMOUNT", money(excl))}${el("TAXAMOUNT", money(vat))}</VATTOTALS>` +
    `<PAYMENTS>${el("PMTTYPE", "INVOICE")}${el("PMTAMOUNT", money(incl))}</PAYMENTS>` +
    `<CHANGES>${el("VATCHANGENUM", 0)}${el("HEADCHANGENUM", 0)}</CHANGES>` +
    "<ERRORS></ERRORS>" +
    el("FWVERSION", "3.0") +
    el("FWCHECKSUM", "WEBAPI") +
    "</ZREPORT>"
  );
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------
const certSerialHeader = (serial: string) => Buffer.from(serial.trim(), "utf8").toString("base64");

async function postXml(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/xml", ...headers },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, text: await res.text() };
}

export async function vfdRegister(v: VfdEnv, certSerial: string, certKey: string): Promise<VfdRegistration & { httpStatus: number }> {
  const body = envelope(registrationPart(v.tin, certKey), v.key);
  const r = await postXml(`${v.base}/api/vfdRegReq`, body, { "Cert-Serial": certSerialHeader(certSerial), Client: "webapi" });
  return { ...parseRegistration(r.text), httpStatus: r.status };
}

export async function vfdToken(
  v: VfdEnv,
  username: string,
  password: string,
  tokenPath = "/vfdtoken",
): Promise<{ ok: true; token: string; expiresAt: Date } | { ok: false; error: string }> {
  try {
    const path = tokenPath.startsWith("http") ? tokenPath : `${v.base}${tokenPath.startsWith("/") ? "" : "/"}${tokenPath}`;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, grant_type: "password" }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) return { ok: false, error: `Token: ${json.error ?? `HTTP ${res.status}`}` };
    const secs = Number(json.expires_in ?? 3600);
    return { ok: true, token: json.access_token, expiresAt: new Date(Date.now() + Math.max(60, secs - 60) * 1000) };
  } catch (e) {
    return { ok: false, error: `Token: ${(e as Error).message}`.slice(0, 300) };
  }
}

export async function vfdPostReceipt(v: VfdEnv, token: string, certSerial: string, routingKey: string, job: ReceiptJob): Promise<VfdAck & { httpStatus: number }> {
  const body = envelope(receiptPart(job), v.key);
  const r = await postXml(`${v.base}/api/efdmsRctInfo`, body, {
    "Routing-Key": routingKey || "vfdrct",
    "Cert-Serial": certSerialHeader(certSerial),
    Authorization: `bearer ${token}`,
  });
  return { ...parseAck(r.text, v.traKey), httpStatus: r.status };
}

export async function vfdPostZReport(v: VfdEnv, token: string, certSerial: string, z: ZJob): Promise<VfdAck & { httpStatus: number }> {
  const body = envelope(zReportPart(z), v.key);
  const r = await postXml(`${v.base}/api/efdmsZReport`, body, {
    "Routing-Key": "vfdzreport",
    "Cert-Serial": certSerialHeader(certSerial),
    Authorization: `bearer ${token}`,
  });
  return { ...parseAck(r.text, v.traKey), httpStatus: r.status };
}
