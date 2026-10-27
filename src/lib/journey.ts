/**
 * "How it works" (/how-it-works): one order followed from the first meeting with a customer to the
 * profit at the end, a step at a time. Each step says what happens in the business, what you do in
 * LeMoSp and where to find it, with an animated sample document.
 * English text; the page shows it through useTr().
 * Sample business: Kilimanjaro Hotels Ltd buys paper and toner; Dar Office Supplies supplies them.
 */

export type Party = "customer" | "you" | "supplier";

export type JourneyDoc = {
  /** Kind of record, e.g. "Quotation". */
  kind: string;
  /** Its number, e.g. "QT-2026-0042" (not translated). */
  number: string;
  /** Lines shown one after another: label, value. */
  lines: [string, string][];
  /** The stamp that lands on the record at the end of the animation. */
  stamp: string;
  tone: "info" | "ok" | "warn";
  /** A line to highlight (index into lines). */
  mark?: number;
};

export type JourneyStep = {
  id: string;
  title: string;
  /** What happens in the business. */
  story: string;
  /** What you do in LeMoSp, step by step. */
  todo: string[];
  /** Where to find it (laptop side menu). */
  where: string[];
  href: string;
  /** Which way the paperwork moves; none = it stays with you. */
  flow?: { from: Party; to: Party };
  doc: JourneyDoc;
  /** Which business sizes have it switched on by default. */
  scales?: "all" | "medium+" | "enterprise";
};

export const JOURNEY: JourneyStep[] = [
  {
    id: "lead",
    title: "Meet the customer",
    story: "Asha, the procurement officer at Kilimanjaro Hotels, calls: the hotel is looking for a new supplier of office paper and toner.",
    todo: [
      "Add the hotel under Clients: name, TIN, phone, email and Asha as the contact person.",
      "On the Pipeline press + Opportunity and enter the expected value, so the team knows it is coming.",
      "Add the next step with its date. LeMoSp reminds you on the day.",
    ],
    where: ["Sales", "Pipeline"],
    href: "/crm",
    flow: { from: "customer", to: "you" },
    doc: {
      kind: "Opportunity",
      number: "Kilimanjaro Hotels Ltd",
      lines: [
        ["Contact", "Asha Mushi, Procurement"],
        ["Looking for", "Office paper and toner"],
        ["Expected value", "TZS 3,000,000"],
        ["Next follow-up", "Tomorrow, 10:00"],
      ],
      stamp: "New lead",
      tone: "info",
    },
    scales: "medium+",
  },
  {
    id: "rfq",
    title: "The customer asks for prices",
    story: "Asha emails a request for quotation: 50 boxes of A4 paper and 10 HP 85A toners, needed within two weeks.",
    todo: [
      "Open Client RFQs and tap + New client RFQ.",
      "Choose the client, how the request arrived (email) and the date it is due.",
      "Add the items from your product list. You get a reminder before the RFQ is due.",
    ],
    where: ["Sales", "Client RFQs"],
    href: "/rfqs",
    flow: { from: "customer", to: "you" },
    doc: {
      kind: "Client RFQ",
      number: "RFQ-2026-0018",
      lines: [
        ["Client", "Kilimanjaro Hotels Ltd"],
        ["A4 paper, box of 5 reams", "50 boxes"],
        ["Toner HP 85A", "10 pieces"],
        ["Needed by", "25 Oct 2026"],
      ],
      stamp: "Received",
      tone: "info",
    },
    scales: "all",
  },
  {
    id: "suppliers",
    title: "Ask your suppliers",
    story: "Before you quote, you check what the goods will cost you. Two suppliers reply with their prices.",
    todo: [
      "On the client RFQ press Request supplier quotes and add two or three suppliers.",
      "Enter each supplier's reply: price, delivery time and validity.",
      "Press Compare prices: the best offer per item is marked, then Award & create PO when the client agrees.",
    ],
    where: ["Purchasing", "Supplier RFQs"],
    href: "/supplier-rfqs",
    flow: { from: "you", to: "supplier" },
    doc: {
      kind: "Supplier prices",
      number: "SRFQ-2026-0012",
      lines: [
        ["Dar Office Supplies", "TZS 2,075,000"],
        ["Mwanza Stationers", "TZS 2,240,000"],
        ["Delivery", "3 days"],
        ["Chosen", "Dar Office Supplies"],
      ],
      stamp: "Best price",
      tone: "ok",
      mark: 0,
    },
    scales: "medium+",
  },
  {
    id: "quote",
    title: "Send the quotation",
    story: "You add your margin and send the hotel a clear, branded quotation with VAT, by WhatsApp and email.",
    todo: [
      "On the client RFQ press Create quotation from these items: nothing is typed twice.",
      "Set your prices, delivery time and payment terms. Managers see the cost and margin of every line.",
      "Press Submit quotation, open the PDF and share it by WhatsApp or email.",
    ],
    where: ["Sales", "Quotations"],
    href: "/quotations",
    flow: { from: "you", to: "customer" },
    doc: {
      kind: "Quotation",
      number: "QT-2026-0042",
      lines: [
        ["A4 paper × 50", "TZS 700,000"],
        ["Toner HP 85A × 10", "TZS 1,850,000"],
        ["VAT 18%", "TZS 459,000"],
        ["Total", "TZS 3,009,000"],
      ],
      stamp: "Sent",
      tone: "info",
      mark: 3,
    },
    scales: "all",
  },
  {
    id: "terms",
    title: "Agree the terms",
    story: "Asha asks for 30 days to pay. You agree, and the hotel sends its purchase order (LPO). The deal is done.",
    todo: [
      "Log each call or visit as a follow-up on the quotation, with the next date.",
      "When the client agrees, press Client accepted and add their LPO number.",
      "For regular supply, keep the agreed prices and terms in a Contract with renewal reminders.",
    ],
    where: ["Sales", "Quotations", "open a quotation"],
    href: "/quotations",
    flow: { from: "customer", to: "you" },
    doc: {
      kind: "Agreed terms",
      number: "QT-2026-0042",
      lines: [
        ["Payment", "30 days after delivery"],
        ["Delivery", "Within 5 days"],
        ["Client's LPO", "KH/LPO/311"],
        ["Price valid", "14 days"],
      ],
      stamp: "Accepted",
      tone: "ok",
    },
    scales: "all",
  },
  {
    id: "po",
    title: "Order from your supplier",
    story: "You order the goods from Dar Office Supplies. A large order is checked by Finance and Management before it goes out.",
    todo: [
      "On the accepted quotation press Create purchase order: the items are filled in.",
      "Press Submit purchase order. Large orders go to the approvers, who get an alert and approve on their phone.",
      "Share the approved PO PDF with the supplier and record their confirmation.",
    ],
    where: ["Purchasing", "Purchase orders"],
    href: "/purchase-orders",
    flow: { from: "you", to: "supplier" },
    doc: {
      kind: "Purchase order",
      number: "PO-2026-0031",
      lines: [
        ["Supplier", "Dar Office Supplies"],
        ["Total", "TZS 2,075,000 + VAT"],
        ["Finance check", "Approved"],
        ["Management", "Approved"],
      ],
      stamp: "Approved",
      tone: "ok",
    },
    scales: "all",
  },
  {
    id: "receive",
    title: "Receive the goods",
    story: "The supplier delivers to your store. Your storekeeper counts everything against the order.",
    todo: [
      "Open Receive goods, choose the purchase order and the store, and enter what actually arrived.",
      "Stock goes up by itself, in the right store, with the real cost.",
      "If only part arrives, LeMoSp keeps track of what is still to come.",
    ],
    where: ["Purchasing", "Receive goods"],
    href: "/receiving",
    flow: { from: "supplier", to: "you" },
    doc: {
      kind: "Goods received",
      number: "GRN-2026-0027",
      lines: [
        ["A4 paper", "50 of 50"],
        ["Toner HP 85A", "10 of 10"],
        ["Store", "Main store"],
        ["Checked by", "Neema, Warehouse"],
      ],
      stamp: "In stock",
      tone: "ok",
    },
    scales: "all",
  },
  {
    id: "deliver",
    title: "Deliver to the customer",
    story: "Your driver takes the goods to the hotel. Asha signs on the driver's phone and a photo is taken as proof.",
    todo: [
      "On the accepted quotation press Create delivery note, choose the driver and vehicle, then Dispatch now.",
      "The driver sees the delivery on their phone, with the address and contact.",
      "At the hotel the driver presses Record delivery: name, signature and photo, even without signal.",
    ],
    where: ["Deliveries"],
    href: "/deliveries",
    flow: { from: "you", to: "customer" },
    doc: {
      kind: "Delivery note",
      number: "DN-2026-0040",
      lines: [
        ["Driver", "Juma, T 123 ABC"],
        ["Received by", "Asha Mushi"],
        ["Signature", "Signed on the phone"],
        ["Proof photo", "1 photo"],
      ],
      stamp: "Delivered",
      tone: "ok",
    },
    scales: "all",
  },
  {
    id: "invoice",
    title: "Send the invoice",
    story: "The hotel gets an invoice with VAT, the due date and your bank and mobile-money numbers.",
    todo: [
      "On the delivered delivery note press Create invoice: nothing is typed twice.",
      "Check the items, VAT and the client's LPO number, then press Issue invoice.",
      "Share the PDF. Your bank details and M-Pesa / Mixx / Airtel Money numbers are printed on it.",
    ],
    where: ["Finance", "Invoices"],
    href: "/invoices",
    flow: { from: "you", to: "customer" },
    doc: {
      kind: "Invoice",
      number: "INV-2026-0055",
      lines: [
        ["Total", "TZS 3,009,000"],
        ["Due", "24 Nov 2026"],
        ["Pay by", "Bank or mobile money"],
        ["Client's LPO", "KH/LPO/311"],
      ],
      stamp: "Issued",
      tone: "info",
    },
    scales: "all",
  },
  {
    id: "paid",
    title: "Get paid",
    story: "Three days before the due date, LeMoSp reminds you to remind the hotel. The money arrives by M-Pesa.",
    todo: [
      "Reminders come before the due date and again while it is overdue, with a ready message for WhatsApp.",
      "On the invoice press + Record a payment received, choose M-Pesa and enter the transaction code.",
      "Tick it against your bank or M-Pesa statement, and send the client a statement any time.",
    ],
    where: ["Finance", "Invoices", "open an invoice"],
    href: "/receivables",
    flow: { from: "customer", to: "you" },
    doc: {
      kind: "Payment received",
      number: "RCT-2026-0049",
      lines: [
        ["Amount", "TZS 3,009,000"],
        ["Method", "M-Pesa"],
        ["Transaction code", "QJK7H2LM4P"],
        ["Invoice INV-2026-0055", "Fully paid"],
      ],
      stamp: "Paid",
      tone: "ok",
      mark: 3,
    },
    scales: "all",
  },
  {
    id: "pay-costs",
    title: "Pay the supplier and your costs",
    story: "You pay Dar Office Supplies on time and record what the job cost you in fuel.",
    todo: [
      "On the purchase order press Record supplier's invoice; the order, receipt and bill check shows any difference.",
      "Press + Record a payment to the supplier. Money we owe shows what is due next.",
      "Record expenses such as fuel with a photo of the receipt.",
    ],
    where: ["Finance", "Supplier bills"],
    href: "/bills",
    flow: { from: "you", to: "supplier" },
    doc: {
      kind: "Supplier bill",
      number: "BILL-2026-0020",
      lines: [
        ["Dar Office Supplies", "TZS 2,448,500"],
        ["Paid by", "Bank transfer"],
        ["Fuel for delivery", "TZS 45,000"],
        ["Receipt photo", "Attached"],
      ],
      stamp: "Settled",
      tone: "ok",
    },
    scales: "all",
  },
  {
    id: "profit",
    title: "See your profit",
    story: "The order is complete. You see exactly what you earned on it, and how the whole business is doing this month.",
    todo: [
      "Profit shows the margin on every sale; Profit & loss gives the month after expenses.",
      "Money owed to us and Money we owe show who pays next and whom you pay next.",
      "Larger companies also see each branch side by side, budgets and a cash-flow forecast.",
    ],
    where: ["Finance", "Profit & loss"],
    href: "/profit-loss",
    doc: {
      kind: "This order",
      number: "QT-2026-0042",
      lines: [
        ["Sales (without VAT)", "TZS 2,550,000"],
        ["Cost of goods", "TZS 2,075,000"],
        ["Fuel", "TZS 45,000"],
        ["Profit", "TZS 430,000 (16.9%)"],
      ],
      stamp: "Profit",
      tone: "ok",
      mark: 3,
    },
    scales: "all",
  },
  {
    id: "safe",
    title: "Your data stays safe",
    story: "From the first call to the last payment, every record is protected and every change is recorded.",
    todo: [
      "Each person signs in with their own account and sees only what their role needs.",
      "Turn on two-step verification and the app lock for phones; idle screens lock themselves.",
      "The Activity log shows who changed what, and backups let you export everything.",
    ],
    where: ["More", "Settings", "Security"],
    href: "/settings/security",
    doc: {
      kind: "Security",
      number: "Kilimanjaro order",
      lines: [
        ["Two-step verification", "On"],
        ["Roles", "Each sees their own work"],
        ["Activity log", "Every change recorded"],
        ["Connection", "Encrypted (HTTPS)"],
      ],
      stamp: "Protected",
      tone: "ok",
    },
    scales: "all",
  },
];

export const SCALE_NOTE: Record<NonNullable<JourneyStep["scales"]>, string> = {
  all: "Small, Medium and Large",
  "medium+": "Medium and Large (Small can switch it on)",
  enterprise: "Large (Enterprise)",
};
