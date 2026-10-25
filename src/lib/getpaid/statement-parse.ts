/**
 * Reads pasted mobile-money SMS messages or bank statement lines into { ref, amount, text } items for
 * public.pay_match_suggest (pure, used by the Match references screen and the tests).
 *
 * Examples it understands:
 *   "QJK3H5TY67 Confirmed. You have received Tsh250,000.00 from 255754123456 - JOHN DOE on 25/10/26 ..."  (M-Pesa)
 *   "TID: MP210325.1234.A12345 Received TZS 50,000 from ASHA ..."                                          (Airtel Money)
 *   "Txn ID: 7712345678. Umepokea TSh 120,000 kutoka ..."                                                  (Mixx / Tigo Pesa)
 *   "25/10/2026  INV-0042 ACME LTD TRANSFER  1,250,000.00"                                                 (bank statement)
 * One item per message: a blank line, or a line that starts a new message (a date or a reference), splits them.
 */

export type StatementItem = { ref: string | null; amount: string | null; text: string };

const LABELLED_REF = /\b(?:TID|TXN\s*ID|TRANS(?:ACTION)?\s*(?:ID|REF)|REF(?:ERENCE)?(?:\s*NO)?|RECEIPT|KUMBUKUMBU|MUAMALA)\s*[:#.]?\s*([A-Z0-9][A-Z0-9.\-/]{5,40})/i;
// A leading code of 8 to 14 letters and digits with both in it (M-Pesa / bank references).
const LEADING_REF = /^\s*([A-Z0-9]{8,14})\b/;
const CURRENCY_AMOUNT = /(?:TSH|TZS|SH|TSHS)\.?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i;
const PLAIN_AMOUNT = /(?<![\w./-])([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d{1,2})?|[0-9]{4,}\.\d{2})(?![\w/-])/g;

function hasLettersAndDigits(s: string) {
  return /[A-Z]/i.test(s) && /\d/.test(s);
}

export function parseStatementItem(text: string): StatementItem {
  const t = text.replace(/\s+/g, " ").trim();
  let ref: string | null = null;
  const labelled = LABELLED_REF.exec(t);
  if (labelled) ref = labelled[1].replace(/[.\-/]+$/, "");
  if (!ref) {
    const lead = LEADING_REF.exec(t);
    if (lead && hasLettersAndDigits(lead[1])) ref = lead[1];
  }
  let amount: string | null = null;
  const cur = CURRENCY_AMOUNT.exec(t);
  if (cur) amount = cur[1];
  else {
    // A bank line: the first grouped or two-decimal number (the later ones are usually the balance).
    const all = [...t.matchAll(PLAIN_AMOUNT)].map((m) => m[1]);
    if (all.length) amount = all[0];
  }
  if (amount) {
    const n = Number(amount.replace(/,/g, ""));
    amount = Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : null;
  }
  return { ref: ref ? ref.toUpperCase().slice(0, 60) : null, amount, text: t.slice(0, 500) };
}

const STARTS_MESSAGE = /^\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\d{4}-\d{2}-\d{2}\b|[A-Z0-9]{10}\s+(?:Confirmed|Imethibitishwa)|TID\s*:|Txn\s*ID\s*:)/i;

/** Splits pasted text into messages and reads each one. At most 200 items. */
export function parseStatement(pasted: string): StatementItem[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.join(" ").trim()) blocks.push(cur.join(" "));
    cur = [];
  };
  for (const line of pasted.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (cur.length && STARTS_MESSAGE.test(line)) flush();
    cur.push(line.trim());
  }
  flush();
  return blocks.slice(0, 200).map(parseStatementItem);
}
