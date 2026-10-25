/**
 * A small MIME reader and writer (pure functions, no packages), for the company-mailbox mode
 * (IMAP in, SMTP out). It handles what real mail from Gmail, Outlook and phones uses:
 * multipart/alternative, mixed and related, base64 and quoted-printable, UTF-8 and Latin-1 text,
 * encoded headers (=?UTF-8?B?...?=) and attachment file names (RFC 2231 too).
 */

export type ParsedMail = {
  headers: Map<string, string>;
  from: string | null;
  to: string;
  cc: string;
  deliveredTo: string;
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string;
  date: string | null;
  text: string;
  html: string;
  attachments: { fileName: string; contentType: string; content: Buffer }[];
};

function decoder(charset: string): (b: Buffer) => string {
  const cs = charset.toLowerCase().replace(/^"|"$/g, "") || "utf-8";
  try {
    const td = new TextDecoder(cs === "us-ascii" || cs === "ascii" ? "utf-8" : cs);
    return (b) => td.decode(b);
  } catch {
    return (b) => b.toString("latin1");
  }
}

function qpBytes(s: string, header = false): Buffer {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "=" && /^[0-9a-f]{2}$/i.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = src.charCodeAt(i);
      if (code < 256) out.push(code);
      else out.push(...Buffer.from(c, "utf8"));
    }
  }
  return Buffer.from(out);
}

/** =?UTF-8?B?...?= and =?ISO-8859-1?Q?...?= words in a header. */
export function decodeWords(v: string): string {
  return v
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bq])\?([^?]*)\?=/gi, (_m, cs: string, enc: string, data: string) => {
      const bytes = enc.toLowerCase() === "b" ? Buffer.from(data, "base64") : qpBytes(data, true);
      return decoder(cs)(bytes);
    });
}

function splitHeaderBody(raw: Buffer): { head: string; body: Buffer } {
  let idx = raw.indexOf("\r\n\r\n");
  let sep = 4;
  if (idx < 0) {
    idx = raw.indexOf("\n\n");
    sep = 2;
  }
  if (idx < 0) return { head: raw.toString("latin1"), body: Buffer.alloc(0) };
  return { head: raw.subarray(0, idx).toString("latin1"), body: raw.subarray(idx + sep) };
}

export function parseHeaders(head: string): Map<string, string> {
  const map = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    // Headers arrive as bytes: UTF-8 in raw headers (allowed since RFC 6532) is decoded here.
    const text = Buffer.from(v, "latin1").toString("utf8").includes("�") ? v : Buffer.from(v, "latin1").toString("utf8");
    map.set(k, map.has(k) && k !== "subject" ? `${map.get(k)}, ${text}` : (map.get(k) ?? text));
  }
  return map;
}

/** value; key=value params of Content-Type / Content-Disposition (with RFC 2231 file names). */
export function headerParams(v: string | undefined): { value: string; params: Record<string, string> } {
  if (!v) return { value: "", params: {} };
  const parts = v.match(/(?:"[^"]*"|[^;])+/g) ?? [];
  const value = (parts.shift() ?? "").trim().toLowerCase();
  const params: Record<string, string> = {};
  const star: Record<string, string[]> = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim().replace(/^"|"$/g, "");
    const m = /^([^*]+)\*(\d+)?\*?$/.exec(k);
    if (m) {
      (star[m[1]] ??= [])[Number(m[2] ?? 0)] = val;
      continue;
    }
    params[k] = decodeWords(val);
  }
  for (const [k, pieces] of Object.entries(star)) {
    let joined = pieces.join("");
    const enc = /^([^']*)'[^']*'(.*)$/.exec(joined);
    if (enc) {
      try {
        const bytes = Buffer.from(enc[2].replace(/%([0-9a-f]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
        joined = decoder(enc[1] || "utf-8")(bytes);
      } catch {
        joined = enc[2];
      }
    }
    params[k] = joined;
  }
  return { value, params };
}

function decodeBody(body: Buffer, encoding: string): Buffer {
  const e = encoding.toLowerCase();
  if (e === "base64") return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (e === "quoted-printable") return qpBytes(body.toString("latin1"));
  return body;
}

type Part = { headers: Map<string, string>; body: Buffer };

function splitMultipart(body: Buffer, boundary: string): Buffer[] {
  const text = body.toString("latin1");
  const marker = `--${boundary}`;
  const out: Buffer[] = [];
  let pos = text.indexOf(marker);
  while (pos >= 0) {
    const start = text.indexOf("\n", pos);
    if (start < 0) break;
    if (text.slice(pos + marker.length, pos + marker.length + 2) === "--") break;
    const next = text.indexOf(`\n${marker}`, start);
    const end = next < 0 ? text.length : next;
    let chunk = text.slice(start + 1, end);
    if (chunk.endsWith("\r")) chunk = chunk.slice(0, -1);
    out.push(Buffer.from(chunk, "latin1"));
    if (next < 0) break;
    pos = next + 1;
  }
  return out;
}

function walk(part: Part, mail: ParsedMail, depth: number) {
  if (depth > 8) return;
  const ct = headerParams(part.headers.get("content-type") ?? "text/plain; charset=us-ascii");
  const cd = headerParams(part.headers.get("content-disposition"));
  const encoding = part.headers.get("content-transfer-encoding") ?? "7bit";
  if (ct.value.startsWith("multipart/") && ct.params.boundary) {
    for (const raw of splitMultipart(part.body, ct.params.boundary).slice(0, 50)) {
      const { head, body } = splitHeaderBody(raw);
      walk({ headers: parseHeaders(head), body }, mail, depth + 1);
    }
    return;
  }
  if (ct.value === "message/rfc822") {
    const fileName = "forwarded-message.eml";
    mail.attachments.push({ fileName, contentType: ct.value, content: decodeBody(part.body, encoding) });
    return;
  }
  const fileName = cd.params.filename ?? ct.params.name ?? null;
  const isAttachment = cd.value === "attachment" || (!!fileName && !ct.value.startsWith("text/"));
  const bytes = decodeBody(part.body, encoding);
  if (!isAttachment && ct.value === "text/plain" && !mail.text) mail.text = decoder(ct.params.charset ?? "utf-8")(bytes);
  else if (!isAttachment && ct.value === "text/html" && !mail.html) mail.html = decoder(ct.params.charset ?? "utf-8")(bytes);
  else if (!isAttachment && ct.value.startsWith("text/")) return; // calendar parts and the like
  else mail.attachments.push({ fileName: fileName ? decodeWords(fileName) : `attachment.${ct.value.split("/")[1] ?? "bin"}`, contentType: ct.value || "application/octet-stream", content: bytes });
}

export function parseMail(raw: Buffer): ParsedMail {
  const { head, body } = splitHeaderBody(raw);
  const headers = parseHeaders(head);
  const h = (k: string) => headers.get(k) ?? "";
  const mail: ParsedMail = {
    headers,
    from: h("from") ? decodeWords(h("from")) : null,
    to: decodeWords(h("to")),
    cc: decodeWords(h("cc")),
    deliveredTo: [h("delivered-to"), h("x-original-to"), h("envelope-to")].filter(Boolean).join(", "),
    subject: decodeWords(h("subject")).replace(/\s+/g, " ").trim(),
    messageId: /<[^<>\s]+>/.exec(h("message-id"))?.[0] ?? null,
    inReplyTo: /<[^<>\s]+>/.exec(h("in-reply-to"))?.[0] ?? null,
    references: h("references"),
    date: h("date") || null,
    text: "",
    html: "",
    attachments: [],
  };
  walk({ headers, body }, mail, 0);
  return mail;
}

// ---------------------------------------------------------------------------------------------
// Writing (for SMTP)

const b64lines = (b: Buffer) => b.toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** A header value as an encoded word when it is not plain ASCII. */
export function encodeWord(v: string): string {
  const clean = v.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** "Name <a@b>" with the name encoded when needed. */
export function addressHeader(name: string | null, address: string): string {
  const n = (name ?? "").replace(/["<>\r\n]/g, "").trim();
  if (!n) return address;
  return /^[\x20-\x7e]*$/.test(n) ? `"${n}" <${address}>` : `${encodeWord(n)} <${address}>`;
}

export type OutgoingMail = {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  date?: Date;
};

/** The whole message as sent over SMTP (CRLF line ends, base64 UTF-8 bodies). */
export function buildMail(m: OutgoingMail): string {
  const boundary = `=_lemosp_${Buffer.from(m.messageId).toString("hex").slice(0, 24)}`;
  const lines = [
    `From: ${m.from}`,
    `To: ${m.to.join(", ")}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length ? [`References: ${m.references.slice(-20).join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64lines(Buffer.from(m.text, "utf8"))];
  if (!m.html) return [...lines, ...textPart, ""].join("\r\n");
  return [
    ...lines,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(Buffer.from(m.html, "utf8")),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
