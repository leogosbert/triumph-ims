import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

/**
 * Company-mailbox mode: works with the mailbox the company already has (Gmail, Outlook, the
 * hosting company's mail), so no own domain or DNS records are needed.
 *   In:  IMAP (read only: EXAMINE + BODY.PEEK, nothing is marked read, moved or deleted).
 *   Out: SMTP (465 with TLS, or 587 with STARTTLS), logging in with the same mailbox.
 * Small clients written with node:net / node:tls only (no packages). Settings:
 *   SMTP_HOST, SMTP_PORT (465 or 587; SMTP_SECURE=true for TLS on another port), SMTP_USER, SMTP_PASS (for Gmail: an App password),
 *   SMTP_FROM (optional, e.g. "Triumph Sales <sales@gmail.com>"), IMAP_HOST (default: SMTP_HOST with
 *   imap. in front), IMAP_PORT (993).
 */

export type MailboxConfig = {
  user: string;
  pass: string;
  smtpHost: string;
  smtpPort: number;
  /** TLS from the start (port 465, or SMTP_SECURE=true); otherwise STARTTLS (587). */
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  from: string;
};

export function mailboxConfig(env: NodeJS.ProcessEnv = process.env): MailboxConfig | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  const smtpHost = env.SMTP_HOST?.trim() ?? "";
  if (!user || !pass) return null;
  const imapHost = env.IMAP_HOST?.trim() || (smtpHost ? smtpHost.replace(/^(smtp|mail)\./i, "imap.") : "");
  return {
    user,
    pass,
    smtpHost,
    smtpPort: Number(env.SMTP_PORT || 465),
    smtpSecure: Number(env.SMTP_PORT || 465) === 465 || env.SMTP_SECURE === "true",
    imapHost,
    imapPort: Number(env.IMAP_PORT || 993),
    from: env.SMTP_FROM?.trim() || user,
  };
}

/** The mailbox address (lower case) — the company whose inbox address equals it owns the mailbox. */
export function mailboxAddress(cfg: MailboxConfig | null): string | null {
  if (!cfg) return null;
  const a = (/<([^>]+)>/.exec(cfg.from)?.[1] ?? (cfg.user.includes("@") ? cfg.user : cfg.from)).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) ? a : null;
}

// ---------------------------------------------------------------------------------------------
// A byte reader over a socket

class Reader {
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private ended: Error | null = null;
  constructor(public sock: Socket | TLSSocket) {
    this.attach(sock);
  }
  attach(sock: Socket | TLSSocket) {
    this.sock = sock;
    sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.wake();
    });
    sock.on("error", (e) => {
      this.ended = e;
      this.wake();
    });
    sock.on("close", () => {
      this.ended ??= new Error("Connection closed");
      this.wake();
    });
  }
  detach() {
    this.sock.removeAllListeners("data");
    this.sock.removeAllListeners("error");
    this.sock.removeAllListeners("close");
  }
  private wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
  private wait() {
    if (this.ended) return Promise.reject(this.ended);
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) {
        const l = this.buf.subarray(0, i).toString("latin1");
        this.buf = this.buf.subarray(i + 2);
        return l;
      }
      if (this.buf.length > 1024 * 1024) throw new Error("Line too long");
      await this.wait();
    }
  }
  async bytes(n: number): Promise<Buffer> {
    while (this.buf.length < n) await this.wait();
    const b = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return b;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`${what}: no answer in time`)), ms)))]).finally(() => clearTimeout(t));
}

function openTls(host: string, port: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tlsConnect({ host, port, servername: host, timeout: 15_000 }, () => resolve(s));
    s.once("error", reject);
    s.once("timeout", () => {
      s.destroy();
      reject(new Error("Could not reach the mail server"));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// IMAP (read only)

export type FetchedMail = { uid: number; raw: Buffer; tooLarge: boolean };

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const imapDate = (d: Date) =>
  `${d.getUTCDate()}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}-${d.getUTCFullYear()}`;

class Imap {
  private n = 0;
  constructor(private r: Reader) {}
  /** Sends a command; returns the untagged lines and the literals that came with them. */
  async cmd(command: string, timeoutMs = 20_000): Promise<{ lines: string[]; literals: Buffer[] }> {
    const tag = `L${++this.n}`;
    this.r.sock.write(`${tag} ${command}\r\n`);
    const lines: string[] = [];
    const literals: Buffer[] = [];
    const run = async () => {
      for (;;) {
        let l = await this.r.line();
        // A line ending in {n} is followed by n raw bytes, then the rest of the line.
        for (let m = /\{(\d+)\}$/.exec(l); m; m = /\{(\d+)\}$/.exec(l)) {
          literals.push(await this.r.bytes(Number(m[1])));
          l = `${l.slice(0, m.index)}<literal ${literals.length - 1}>${await this.r.line()}`;
        }
        if (l.startsWith(`${tag} `)) {
          if (!/^\S+ OK/i.test(l)) throw new Error(`IMAP: ${l.slice(tag.length + 1, tag.length + 120)}`);
          return;
        }
        lines.push(l);
      }
    };
    await withTimeout(run(), timeoutMs, "IMAP");
    return { lines, literals };
  }
}

/**
 * Reads new mail in INBOX: everything after lastUid (same UIDVALIDITY), or the last `firstDays`
 * days the first time. Oldest first, at most `max` messages, messages over maxBytes come as headers only.
 */
export async function imapFetchNew(
  cfg: MailboxConfig,
  state: { uidValidity: number | null; lastUid: number | null },
  opts: { max?: number; maxBytes?: number; firstDays?: number; deadline?: number } = {},
): Promise<{ uidValidity: number; uidNext: number | null; mails: FetchedMail[]; more: boolean }> {
  const max = opts.max ?? 15;
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  if (!cfg.imapHost) throw new Error("IMAP_HOST is not set");
  const sock = await openTls(cfg.imapHost, cfg.imapPort);
  const r = new Reader(sock);
  const imap = new Imap(r);
  try {
    const greet = await withTimeout(r.line(), 10_000, "IMAP");
    if (!/^\* (OK|PREAUTH)/i.test(greet)) throw new Error("IMAP: unexpected greeting");
    await imap.cmd(`LOGIN ${quote(cfg.user)} ${quote(cfg.pass)}`).catch(() => {
      throw new Error("The mailbox refused the login. Check SMTP_USER and SMTP_PASS (an app password for Gmail or Outlook).");
    });
    const ex = await imap.cmd("EXAMINE INBOX");
    const uv = Number(/UIDVALIDITY (\d+)/i.exec(ex.lines.join("\n"))?.[1] ?? 0);
    const next = /UIDNEXT (\d+)/i.exec(ex.lines.join("\n"))?.[1];
    const sameBox = state.uidValidity === uv && state.lastUid != null;
    const search = sameBox
      ? await imap.cmd(`UID SEARCH UID ${state.lastUid! + 1}:*`)
      : await imap.cmd(`UID SEARCH SINCE ${imapDate(new Date(Date.now() - (opts.firstDays ?? 2) * 86_400_000))}`);
    const uids = (/^\* SEARCH(.*)$/im.exec(search.lines.join("\n"))?.[1] ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((u) => Number.isFinite(u) && (!sameBox || u > state.lastUid!))
      .sort((a, b) => a - b);
    const pick = uids.slice(0, max);
    const mails: FetchedMail[] = [];
    for (const uid of pick) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      const sz = await imap.cmd(`UID FETCH ${uid} (UID RFC822.SIZE)`);
      const size = Number(/RFC822\.SIZE (\d+)/i.exec(sz.lines.join("\n"))?.[1] ?? 0);
      const tooLarge = size > maxBytes;
      const got = await imap.cmd(`UID FETCH ${uid} (UID ${tooLarge ? "BODY.PEEK[HEADER]" : "BODY.PEEK[]"})`, 30_000);
      if (got.literals[0]) mails.push({ uid, raw: got.literals[0], tooLarge });
    }
    await imap.cmd("LOGOUT", 5_000).catch(() => undefined);
    return { uidValidity: uv, uidNext: next ? Number(next) : null, mails, more: uids.length > mails.length };
  } finally {
    sock.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// SMTP

async function smtpReply(r: Reader): Promise<{ code: number; text: string }> {
  let text = "";
  for (;;) {
    const l = await r.line();
    text += `${l.slice(4)}\n`;
    if (!/^\d{3}-/.test(l)) return { code: Number(l.slice(0, 3)), text };
  }
}

/** Sends one message (already built with buildMail) to every recipient. */
export async function smtpSend(cfg: MailboxConfig, envelope: { from: string; to: string[] }, data: string): Promise<void> {
  if (!cfg.smtpHost) throw new Error("SMTP_HOST is not set");
  const implicit = cfg.smtpSecure;
  let sock: Socket | TLSSocket = implicit
    ? await openTls(cfg.smtpHost, cfg.smtpPort)
    : await new Promise<Socket>((resolve, reject) => {
        const s = netConnect({ host: cfg.smtpHost, port: cfg.smtpPort, timeout: 15_000 }, () => resolve(s));
        s.once("error", reject);
        s.once("timeout", () => {
          s.destroy();
          reject(new Error("Could not reach the mail server"));
        });
      });
  let r = new Reader(sock);
  const say = async (line: string | null, ok: number[], what: string) => {
    if (line !== null) sock.write(`${line}\r\n`);
    const res = await withTimeout(smtpReply(r), 20_000, "SMTP");
    if (!ok.includes(res.code)) throw new Error(`${what}: ${res.code} ${res.text.trim().slice(0, 160)}`);
    return res;
  };
  try {
    await say(null, [220], "Mail server greeting");
    const ehlo = await say("EHLO lemosp.app", [250], "EHLO");
    if (!implicit) {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error("The mail server does not offer STARTTLS on this port");
      await say("STARTTLS", [220], "STARTTLS");
      r.detach();
      sock = await new Promise<TLSSocket>((resolve, reject) => {
        const t = tlsConnect({ socket: sock as Socket, servername: cfg.smtpHost }, () => resolve(t));
        t.once("error", reject);
      });
      r = new Reader(sock);
      await say("EHLO lemosp.app", [250], "EHLO");
    }
    await say(`AUTH PLAIN ${Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, "utf8").toString("base64")}`, [235], "Login").catch(() => {
      throw new Error("The mailbox password was refused. Check SMTP_USER and SMTP_PASS (an app password for Gmail or Outlook).");
    });
    await say(`MAIL FROM:<${envelope.from}>`, [250], "Sender");
    for (const to of envelope.to) await say(`RCPT TO:<${to}>`, [250, 251], `Recipient ${to}`);
    await say("DATA", [354], "DATA");
    const body = data.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    await say(`${body}${body.endsWith("\r\n") ? "" : "\r\n"}.`, [250], "Message");
    sock.write("QUIT\r\n");
  } finally {
    setTimeout(() => sock.destroy(), 200).unref?.();
  }
}
