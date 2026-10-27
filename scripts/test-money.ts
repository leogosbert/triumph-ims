/**
 * Unit tests for "Getting paid" (no network, nothing is sent):
 *   npx tsx --test scripts/test-money.ts
 * Signature checks (Selcom webhook, TRA VFD), payload builders (Selcom order, VFD receipt and Z report,
 * Beem SMS, WhatsApp template), statement parsing, schedules, reminder texts and the QR encoder.
 */
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { parseSchedule, stepLabel } from "../src/lib/getpaid/common";
import { channelToMethod } from "../src/lib/getpaid/gateways/types";
import { selcomDigest, selcomHeaders, selcomOrderBody, selcomSignedText, selcomTimestamp, verifySelcomWebhook } from "../src/lib/getpaid/gateways/selcom";
import { encodeQr } from "../src/lib/getpaid/qr";
import { reminderHtml, reminderSms, reminderSubject, reminderText, toneFor, type ReminderData } from "../src/lib/getpaid/reminder-text";
import { beemAuthHeader, beemPayload } from "../src/lib/getpaid/sms-beem";
import { parseStatement, parseStatementItem } from "../src/lib/getpaid/statement-parse";
import {
  envelope,
  parseAck,
  parseRegistration,
  receiptPart,
  registrationPart,
  signVfd,
  tzDateTime,
  verifyVfd,
  vfdConfigured,
  vfdEnv,
  xmlEscape,
  xmlValue,
  zReportPart,
  type ReceiptJob,
} from "../src/lib/getpaid/tra-vfd";

const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// ------------------------------------------------------------------ Selcom
describe("Selcom", () => {
  const env = { key: "KEY123", secret: "SECRET456", vendor: "TILL001", base: "https://example.invalid", verify: "digest" as const, defaultEmail: null };

  it("signs timestamp first, then the fields in order", () => {
    const text = selcomSignedText("2026-10-25T10:00:00+03:00", ["vendor", "order_id", "amount"], { vendor: "V", order_id: "O-1", amount: 500 });
    assert.equal(text, "timestamp=2026-10-25T10:00:00+03:00&vendor=V&order_id=O-1&amount=500");
    const want = createHmac("sha256", "s").update(text).digest("base64");
    assert.equal(selcomDigest("s", "2026-10-25T10:00:00+03:00", ["vendor", "order_id", "amount"], { vendor: "V", order_id: "O-1", amount: 500 }), want);
  });

  it("writes the timestamp in Tanzania time", () => {
    assert.equal(selcomTimestamp(new Date("2026-10-25T07:49:31Z")), "2026-10-25T10:49:31+03:00");
  });

  it("builds request headers with every body field signed", () => {
    const h = selcomHeaders(env, { vendor: "TILL001", order_id: "INV-1-AB" }, new Date("2026-10-25T07:00:00Z"));
    assert.equal(h.Authorization, `SELCOM ${Buffer.from("KEY123").toString("base64")}`);
    assert.equal(h["Signed-Fields"], "vendor,order_id");
    assert.equal(h.Digest, selcomDigest("SECRET456", "2026-10-25T10:00:00+03:00", ["vendor", "order_id"], { vendor: "TILL001", order_id: "INV-1-AB" }));
  });

  it("builds the order body (urls in base64, whole shillings, phone digits)", () => {
    const b = selcomOrderBody(env, {
      orderId: "INV-2026-0001-ABCD1234",
      amount: 150000.4,
      currency: "TZS",
      buyer: { name: "Acme Ltd", email: null, phone: "+255 754 123 456" },
      description: "Triumph: invoice INV-2026-0001",
      returnUrl: "https://app.example/pay/x?done=1",
      cancelUrl: "https://app.example/pay/x",
      webhookUrl: "https://app.example/api/payments/selcom",
    });
    assert.equal(b.amount, 150000);
    assert.equal(b.buyer_phone, "255754123456");
    assert.equal(b.vendor, "TILL001");
    assert.equal(Buffer.from(String(b.webhook), "base64").toString(), "https://app.example/api/payments/selcom");
    assert.equal(b.buyer_email, "payments@example.com");
  });

  const signedWebhook = (body: Record<string, unknown>, opts: { key?: string; secret?: string; fields?: string[]; at?: Date } = {}) => {
    const fields = opts.fields ?? Object.keys(body);
    const ts = selcomTimestamp(opts.at ?? new Date());
    const headers = new Headers({
      Authorization: `SELCOM ${Buffer.from(opts.key ?? env.key).toString("base64")}`,
      "Digest-Method": "HS256",
      Timestamp: ts,
      "Signed-Fields": fields.join(","),
      Digest: selcomDigest(opts.secret ?? env.secret, ts, fields, body),
    });
    return { headers, raw: JSON.stringify(body) };
  };
  const paid = { transid: "7945454515", order_id: "INV-2026-0001-ABCD1234", reference: "0289999288", result: "SUCCESS", resultcode: "000", payment_status: "COMPLETED", amount: "150000", channel: "MPESA-TZ", phone: "255754123456" };

  it("accepts a correctly signed webhook and reads it", () => {
    const { headers, raw } = signedWebhook(paid);
    const r = verifySelcomWebhook(env, headers, raw);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.event.status, "success");
    assert.equal(r.event.amount, 150000);
    assert.equal(r.event.method, "mobile_money");
    assert.equal(r.event.mmProvider, "mpesa");
    assert.equal(r.event.transactionId, "7945454515");
  });

  it("refuses a wrong secret, a wrong key, an old timestamp and unsigned fields", () => {
    const bad = signedWebhook(paid, { secret: "nope" });
    assert.deepEqual(verifySelcomWebhook(env, bad.headers, bad.raw), { ok: false, reason: "bad_signature", orderId: paid.order_id });
    const wrongKey = signedWebhook(paid, { key: "other" });
    assert.equal((verifySelcomWebhook(env, wrongKey.headers, wrongKey.raw) as { reason: string }).reason, "bad_key");
    const old = signedWebhook(paid, { at: new Date(Date.now() - 60 * 60 * 1000) });
    assert.equal((verifySelcomWebhook(env, old.headers, old.raw) as { reason: string }).reason, "old_timestamp");
    const partial = signedWebhook(paid, { fields: ["order_id", "transid"] });
    assert.equal((verifySelcomWebhook(env, partial.headers, partial.raw) as { reason: string }).reason, "unsigned_fields");
  });

  it("refuses a body changed after signing", () => {
    const { headers, raw } = signedWebhook(paid);
    const tampered = raw.replace('"150000"', '"1500000"');
    assert.equal((verifySelcomWebhook(env, headers, tampered) as { reason: string }).reason, "bad_signature");
  });

  it("refuses bodies that are not JSON or have no order", () => {
    assert.equal((verifySelcomWebhook(env, new Headers(), "nope") as { reason: string }).reason, "not_json");
    assert.equal((verifySelcomWebhook(env, new Headers(), "{}") as { reason: string }).reason, "no_order");
  });

  it("in status mode reads without a signature (the order-status answer decides)", () => {
    const r = verifySelcomWebhook({ ...env, verify: "status" }, new Headers(), JSON.stringify({ ...paid, payment_status: "PENDING" }));
    assert.equal(r.ok && r.event.status, "pending");
    const f = verifySelcomWebhook({ ...env, verify: "status" }, new Headers(), JSON.stringify({ ...paid, payment_status: "CANCELLED" }));
    assert.equal(f.ok && f.event.status, "failed");
  });

  it("maps channels to payment methods", () => {
    assert.deepEqual(channelToMethod("AIRTELMONEY"), { method: "mobile_money", mmProvider: "airtel_money" });
    assert.deepEqual(channelToMethod("TIGOPESA"), { method: "mobile_money", mmProvider: "tigopesa" });
    assert.deepEqual(channelToMethod("HALOPESA"), { method: "mobile_money", mmProvider: "halopesa" });
    assert.deepEqual(channelToMethod("VISA"), { method: "bank_transfer", mmProvider: null });
    assert.deepEqual(channelToMethod(null), { method: "other", mmProvider: null });
  });
});

// ------------------------------------------------------------------ TRA VFD
describe("TRA VFD", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pemKey = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("reads the server settings (PEM or base64 PEM) and needs a 9-digit TIN", () => {
    assert.equal(vfdConfigured(E({ TRA_VFD_PRIVATE_KEY: pemKey, TRA_VFD_TIN: "123-456-789" })), true);
    assert.equal(vfdConfigured(E({ TRA_VFD_PRIVATE_KEY: pemKey, TRA_VFD_TIN: "1234" })), false);
    assert.equal(vfdConfigured(E({})), false);
    const v = vfdEnv(E({ TRA_VFD_PRIVATE_KEY: Buffer.from(pemKey).toString("base64"), TRA_VFD_TIN: "123456789" }));
    assert.ok(v);
    assert.equal(v!.tin, "123456789");
    assert.equal(v!.env, "test");
    assert.equal(v!.base, "https://vfdtest.tra.go.tz");
    assert.equal(vfdEnv(E({ TRA_VFD_PRIVATE_KEY: pemKey, TRA_VFD_TIN: "123456789", TRA_VFD_ENV: "live" }))!.base, "https://vfd.tra.go.tz");
    assert.equal(vfdEnv(E({ TRA_VFD_PRIVATE_KEY: "not a key", TRA_VFD_TIN: "123456789" })), null);
  });

  it("signs with SHA1withRSA and the signature checks out", () => {
    const part = registrationPart("123456789", "10TZ101807");
    assert.equal(part, "<REGDATA><TIN>123456789</TIN><CERTKEY>10TZ101807</CERTKEY></REGDATA>");
    const sig = signVfd(part, privateKey);
    assert.equal(verifyVfd(part, sig, publicKey), true);
    assert.equal(verifyVfd(part.replace("1234", "9999"), sig, publicKey), false);
    const env = envelope(part, privateKey);
    assert.match(env, /^<\?xml version="1.0" encoding="UTF-8"\?><EFDMS><REGDATA>.*<\/REGDATA><EFDMSSIGNATURE>[A-Za-z0-9+/=]+<\/EFDMSSIGNATURE><\/EFDMS>$/);
    assert.equal(verifyVfd(part, xmlValue(env, "EFDMSSIGNATURE")!, publicKey), true);
  });

  it("escapes XML and reads values back", () => {
    assert.equal(xmlEscape(`A&B <"x"> 'y'`), "A&amp;B &lt;&quot;x&quot;&gt; &apos;y&apos;");
    assert.equal(xmlValue("<X><NAME>A &amp; B</NAME></X>", "NAME"), "A & B");
    assert.equal(xmlValue("<X></X>", "NAME"), null);
  });

  it("gives the Tanzania date and time of a receipt", () => {
    assert.deepEqual(tzDateTime("2026-10-25T21:30:05Z"), ["2026-10-26", "00:30:05"]);
  });

  const job: ReceiptJob = {
    receipt: { id: "r1", gc: 42, dc: 3, z_number: "20261025", verification_code: "ABC12342", receipt_at: "2026-10-25T07:49:31Z" },
    settings: { tin: "123456789", reg_id: "TZ0100551234", vfd_serial: "10TZ101807", zero_tax_code: 5, receipt_code: "ABC123" },
    invoice: { number: "INV-2026-0001", vat_rate: 18, subtotal: 100000, vat_amount: 18000, total: 118000, discount: 0 },
    client: { name: "Acme & Sons <Ltd>", tin: "987-654-321", phone: "255754123456" },
    lines: [
      { id: 1, desc: "Cable 2.5mm", qty: 3, amount: 59000.004 },
      { id: 2, desc: "Labour", qty: 1, amount: 58999.5 },
    ],
  };

  it("builds the receipt part (client TIN, escaped name, lines adding up, VAT totals)", () => {
    const x = receiptPart(job);
    assert.match(x, /^<RCT><DATE>2026-10-25<\/DATE><TIME>10:49:31<\/TIME><TIN>123456789<\/TIN>/);
    assert.match(x, /<CUSTIDTYPE>1<\/CUSTIDTYPE><CUSTID>987654321<\/CUSTID>/);
    assert.match(x, /<CUSTNAME>Acme &amp; Sons &lt;Ltd&gt;<\/CUSTNAME>/);
    assert.match(x, /<RCTNUM>42<\/RCTNUM><DC>3<\/DC><GC>42<\/GC><ZNUM>20261025<\/ZNUM><RCTVNUM>ABC12342<\/RCTVNUM>/);
    const amts = [...x.matchAll(/<AMT>([\d.]+)<\/AMT>/g)].map((m) => Number(m[1]));
    assert.equal(Math.round(amts.reduce((a, b) => a + b, 0) * 100) / 100, 118000);
    assert.match(x, /<TAXCODE>1<\/TAXCODE>/);
    assert.match(x, /<VATTOTALS><VATRATE>A<\/VATRATE><NETTAMOUNT>100000.00<\/NETTAMOUNT><TAXAMOUNT>18000.00<\/TAXAMOUNT><\/VATTOTALS>/);
    assert.match(x, /<PMTTYPE>INVOICE<\/PMTTYPE><PMTAMOUNT>118000.00<\/PMTAMOUNT>/);
  });

  it("uses the company's zero-VAT code and no client TIN when there is none", () => {
    const x = receiptPart({ ...job, invoice: { ...job.invoice, vat_rate: 0, vat_amount: 0, total: 100000 }, settings: { ...job.settings, zero_tax_code: 3 }, client: { name: "Walk-in", tin: null, phone: null }, lines: [{ id: 1, desc: "X", qty: 1, amount: 100000 }] });
    assert.match(x, /<TAXCODE>3<\/TAXCODE>/);
    assert.match(x, /<CUSTIDTYPE>6<\/CUSTIDTYPE><CUSTID><\/CUSTID>/);
    assert.match(x, /<VATRATE>C<\/VATRATE>/);
  });

  it("reads TRA's acknowledgement and checks its signature when TRA's key is given", () => {
    const tra = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const ackPart = "<RCTACK><RCTNUM>42</RCTNUM><DATE>2026-10-25</DATE><TIME>10:49:33</TIME><ACKCODE>0</ACKCODE><ACKMSG>Success</ACKMSG></RCTACK>";
    const signed = `<?xml version="1.0" encoding="UTF-8"?><EFDMS>${ackPart}<EFDMSSIGNATURE>${signVfd(ackPart, tra.privateKey)}</EFDMSSIGNATURE></EFDMS>`;
    assert.deepEqual(parseAck(signed), { ok: true, code: "0", message: "Success", signatureOk: null });
    assert.deepEqual(parseAck(signed, tra.publicKey), { ok: true, code: "0", message: "Success", signatureOk: true });
    const forged = signed.replace("<ACKCODE>0</ACKCODE>", "<ACKCODE>0 </ACKCODE>");
    assert.equal(parseAck(forged, tra.publicKey).ok, false);
    assert.equal(parseAck(signed.replace("<ACKCODE>0<", "<ACKCODE>7<")).ok, false);
  });

  it("reads the registration answer", () => {
    const r = parseRegistration(
      "<EFDMS><EFDMSRESP><ACKCODE>0</ACKCODE><ACKMSG>Registration Successful</ACKMSG><REGID>TZ0100551234</REGID><SERIAL>10TZ101807</SERIAL><UIN>09VFDWEBAPI-10131758710TZ100</UIN><TIN>123456789</TIN><RECEIPTCODE>ABC123</RECEIPTCODE><ROUTINGKEY>vfdrct</ROUTINGKEY><GC>7</GC><TAXOFFICE>Tax Office Ilala</TAXOFFICE><USERNAME>babaee</USERNAME><PASSWORD>Pa$$&amp;word</PASSWORD><TOKENPATH>vfdtoken</TOKENPATH></EFDMSRESP></EFDMS>",
    );
    assert.equal(r.ackCode, "0");
    assert.equal(r.reg_id, "TZ0100551234");
    assert.equal(r.receipt_code, "ABC123");
    assert.equal(r.gc, 7);
    assert.equal(r.password, "Pa$$&word");
  });

  it("builds the Z report part", () => {
    const z = zReportPart({
      zreport: { id: "z1", z_day: "2026-10-24", receipts: 5, total_excl: 500000, vat_amount: 90000, total_incl: 590000 },
      settings: { tin: "123456789", reg_id: "TZ0100551234", vfd_serial: "10TZ101807", tax_office: "Ilala", registered_at: "2026-10-01T08:00:00Z", uin: "UIN1" },
      company: { name: "Triumph & Co", address: "Dar es Salaam", phone: "0754000000", vrn: "40-012345-A" },
    });
    assert.match(z, /^<ZREPORT><DATE>2026-10-24<\/DATE>/);
    assert.match(z, /<LINE>Triumph &amp; Co<\/LINE>/);
    assert.match(z, /<ZNUMBER>20261024<\/ZNUMBER>/);
    assert.match(z, /<DAILYTOTALAMOUNT>590000.00<\/DAILYTOTALAMOUNT>/);
    assert.match(z, /<TICKETSFISCAL>5<\/TICKETSFISCAL>/);
    assert.match(z, /<VATRATE>A-18.00<\/VATRATE><NETTAMOUNT>500000.00<\/NETTAMOUNT><TAXAMOUNT>90000.00<\/TAXAMOUNT>/);
  });
});

// ------------------------------------------------------------------ Beem SMS
describe("Beem SMS", () => {
  it("builds the payload with a Tanzanian number", () => {
    assert.deepEqual(beemPayload("TRIUMPH", "0754 123 456", "Hello"), {
      source_addr: "TRIUMPH",
      schedule_time: "",
      encoding: 0,
      message: "Hello",
      recipients: [{ recipient_id: 1, dest_addr: "255754123456" }],
    });
    assert.equal(beemPayload("TRIUMPH", "12", "Hello"), null);
    assert.equal((beemPayload("X", "+255754123456", "a".repeat(2000))!.message as string).length, 918);
  });
  it("uses Basic authentication from key and secret", () => {
    assert.equal(beemAuthHeader("k", "s"), `Basic ${Buffer.from("k:s").toString("base64")}`);
  });
});

// ------------------------------------------------------------------ Statements
describe("Statement parsing", () => {
  it("reads M-Pesa, Airtel, Mixx and bank lines", () => {
    const m = parseStatementItem("QJK3H5TY67 Confirmed. You have received Tsh250,000.00 from 255754123456 - JOHN DOE on 25/10/26 at 10:15 AM New M-Pesa balance is Tsh1,000,000.00.");
    assert.deepEqual([m.ref, m.amount], ["QJK3H5TY67", "250000"]);
    const a = parseStatementItem("TID: MP210325.1234.A12345 Received TZS 50,000 from ASHA JUMA 0688123456");
    assert.deepEqual([a.ref, a.amount], ["MP210325.1234.A12345", "50000"]);
    const t = parseStatementItem("Txn ID: 7712345678. Umepokea TSh 120,000 kutoka ACME LTD");
    assert.deepEqual([t.ref, t.amount], ["7712345678", "120000"]);
    const b = parseStatementItem("25/10/2026  INV-0042 ACME LTD TRANSFER  1,250,000.00  9,800,000.00");
    assert.deepEqual([b.ref, b.amount], [null, "1250000"]);
  });
  it("splits pasted text into messages", () => {
    const items = parseStatement(
      "QJK3H5TY67 Confirmed. You have received Tsh250,000.00 from\n255754123456 - JOHN DOE\nQJK3H5TY68 Confirmed. You have received Tsh10,000.00 from X\n\n25/10/2026 INV-1 1,000.00\n26/10/2026 INV-2 2,000.00",
    );
    assert.deepEqual(
      items.map((i) => [i.ref, i.amount]),
      [
        ["QJK3H5TY67", "250000"],
        ["QJK3H5TY68", "10000"],
        [null, "1000"],
        [null, "2000"],
      ],
    );
  });
});

// ------------------------------------------------------------------ Schedules and texts
describe("Reminders", () => {
  it("reads a schedule", () => {
    assert.deepEqual(parseSchedule("-3, 0, 7, 14"), [-3, 0, 7, 14]);
    assert.deepEqual(parseSchedule("14 7 +0 −3 7"), [-3, 0, 7, 14]);
    assert.equal(parseSchedule("soon"), null);
    assert.equal(parseSchedule("-31"), null);
    assert.equal(parseSchedule("1,2,3,4,5,6,7,8,9"), null);
  });
  it("names the steps", () => {
    assert.equal(stepLabel(-1), "1 day before the due date");
    assert.equal(stepLabel(0), "On the due date");
    assert.equal(stepLabel(14), "14 days after the due date");
    assert.deepEqual([-3, 0, 7, 14].map(toneFor), ["before", "due", "overdue", "firm"]);
  });
  const d: ReminderData = {
    companyName: "Triumph Ltd",
    companyPhone: "0754 000 000",
    clientName: "Acme Ltd",
    contactName: "Asha",
    invoiceNumber: "INV-2026-0001",
    currency: "TZS",
    balance: 1250000,
    dueDate: "2026-11-10",
    step: 7,
    payUrl: "https://app.example/pay/0123456789abcdef0123456789abcdef",
    bankDetails: "CRDB 0150000000",
    mobileMoneyDetails: "M-Pesa Lipa 123456",
  };
  it("writes English, Kiswahili and both, with the pay link", () => {
    const en = reminderText(d, "en");
    assert.match(en, /^Dear Asha,/);
    assert.match(en, /7 days overdue/);
    assert.match(en, /TZS 1,250,000/);
    assert.ok(en.includes(d.payUrl!));
    const sw = reminderText(d, "sw");
    assert.match(sw, /^Ndugu Asha,/);
    assert.match(sw, /imechelewa siku 7/);
    assert.match(sw, /10 Nov 2026/);
    const both = reminderText(d, "both");
    assert.ok(both.indexOf("Ndugu") < both.indexOf("Dear"));
    assert.match(reminderSubject(d, "both"), /^Overdue invoice \/ Ankara iliyochelewa: INV-2026-0001/);
    assert.match(reminderHtml({ ...d, companyName: "A<B>" }, "en"), /A&lt;B&gt;/);
  });
  it("keeps the SMS short and with the pay link", () => {
    for (const step of [-3, 0, 7, 30]) {
      for (const lang of ["en", "sw", "both"] as const) {
        const s = reminderSms({ ...d, step }, lang);
        assert.ok(s.length <= 306, `${lang} ${step}: ${s.length}`);
        assert.ok(s.includes(d.payUrl!));
      }
    }
    assert.match(reminderSms({ ...d, step: -3 }, "en"), /is due 10 Nov 2026/);
  });
});

// ------------------------------------------------------------------ QR
describe("QR encoder", () => {
  it("makes square grids of the right size with the three finder patterns", () => {
    for (const [text, size] of [
      ["HELLO", 21],
      ["https://verify.tra.go.tz/ABC12342_104931", 29],
    ] as const) {
      const g = encodeQr(text, "M");
      assert.equal(g.length, size);
      assert.ok(g.every((r) => r.length === size));
      for (const [x, y] of [
        [0, 0],
        [size - 7, 0],
        [0, size - 7],
      ]) {
        // Finder: dark ring, light ring, dark 3x3 centre.
        assert.equal(g[y][x], true);
        assert.equal(g[y + 1][x + 1], false);
        assert.equal(g[y + 3][x + 3], true);
        assert.equal(g[y + 6][x + 6], true);
      }
    }
  });
});
