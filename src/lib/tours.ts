import { featureForRoute } from "@/lib/features";
import { isLevel, type Level } from "@/lib/levels";
import { can, type Permission, type Role } from "@/lib/roles";

/**
 * Guided tours (Stage 12): spotlight steps that run over the REAL screens.
 * Each level has its own tour, written for the owner of a supplier business in Tanzania:
 * what the screen does, who normally uses it and how it helps the business.
 * All text is English (the key); the tour host translates it with useTr().
 */

export type TourStep = {
  /** Screen the step runs on, e.g. "/stock". */
  route: string;
  /** Element(s) to point at, tried in order; the first one visible on screen wins. None → a centred card. */
  selector?: string | string[];
  title: string;
  body: string;
  /** "Who uses it". */
  who?: string;
  /** "Why it helps". */
  why?: string;
  /** Feature switch the step belongs to; skipped when switched off. Default: the feature of `route`. null = always. */
  feature?: string | null;
  /** Who may open the screen; skipped for other roles. "staff" = everyone except drivers. */
  perm?: Permission | "manager" | "staff";
};

export type TourId = Level;

export type Tour = { id: TourId; title: string; steps: TourStep[] };

const HEAD = [".page-head", "main.page h1"];

const SMALL: TourStep[] = [
  {
    route: "/",
    selector: [".tower-card", ".hero"],
    perm: "staff",
    title: "Home: what needs your attention",
    body: "Every morning, start here. Red lines are urgent (late payments, items out of stock), orange lines need attention soon, green lines are going well. Tap any line to open the list behind it.",
    who: "The owner and every member of staff.",
    why: "You see the whole business in one minute, without opening notebooks or Excel.",
  },
  {
    route: "/clients",
    selector: [".rec-list", ...HEAD],
    title: "Customers",
    body: "Keep each customer in one place: phone, email, TIN, contacts and everything you have quoted, delivered and invoiced to them.",
    who: "Owner and sales staff.",
    why: "No more searching WhatsApp chats for a customer's number or their last price.",
  },
  {
    route: "/stock",
    selector: [".stat-grid", ".store-card", ...HEAD],
    perm: "seeStock",
    title: "Products and stock",
    body: "Stock goes up when goods come in (stock-in) and goes down when you deliver to a customer (stock-out). Set a reorder level on each product: when stock falls below it, LeMoSp sends you a low-stock alert.",
    who: "Owner and storekeeper.",
    why: "You always know what you have, and you stop losing sales because an item quietly ran out.",
  },
  {
    route: "/quotations",
    selector: [".tabs-row", ...HEAD],
    perm: "seeSales",
    title: "Quotations",
    body: "When a customer asks for prices, make a quotation and share the PDF by WhatsApp or email. Follow each one from requested, to sent, to accepted or rejected.",
    who: "Owner and sales staff.",
    why: "Professional quotations in minutes, and you can see which ones still need a follow-up call.",
  },
  {
    route: "/deliveries",
    selector: [".tabs-row", ".rec-list", ...HEAD],
    perm: "seeDeliveries",
    title: "Deliveries",
    body: "A delivery note shows what goes to the customer. The driver or customer signs on the phone when the goods arrive.",
    who: "Storekeeper and driver.",
    why: "Signed proof of delivery ends arguments about what was supplied and when.",
  },
  {
    route: "/invoices",
    selector: [".tabs-row", ...HEAD],
    perm: "seeInvoices",
    title: "Invoices and receipts",
    body: "Turn a delivery into an invoice with one tap. Each payment you record gives the customer a receipt PDF.",
    who: "Owner or accountant.",
    why: "Invoices go out the same day, so you get paid sooner.",
  },
  {
    route: "/receivables",
    selector: [".stat-grid", "main.page h1"],
    perm: "seeFinance",
    title: "Payments: who owes us",
    body: "Here are all customers who still owe money, grouped by how late they are. Record part payments; the balance updates by itself.",
    who: "Owner or accountant.",
    why: "You know exactly whom to call this week, and cash flow stops being a surprise.",
  },
  {
    route: "/purchase-orders",
    selector: [".tabs-row", ...HEAD],
    perm: "seePurchasing",
    title: "Purchases from suppliers",
    body: "Record what you buy from each supplier with a simple purchase order. When the goods arrive, receive them into stock.",
    who: "Owner or the person who buys.",
    why: "You know what you ordered, what has arrived and what you paid, for every supplier.",
  },
  {
    route: "/suggestions",
    selector: HEAD,
    title: "Suggestion Box",
    body: "Anyone in the team can send an idea to improve the business: cut costs, serve customers better, work safer. The owner reviews each idea and follows it up.",
    who: "Everyone in the company.",
    why: "Good ideas from staff are no longer forgotten.",
  },
  {
    route: "/growth",
    selector: [".grow-level", ...HEAD],
    feature: null,
    title: "The app grows with you",
    body: "LeMoSp watches your real activity. When you have more customers, products or staff, it suggests the next tools that would help, with the reason why. You decide; nothing is ever deleted.",
    who: "The owner.",
    why: "Start simple today and switch on more tools only when your business needs them.",
  },
];

const MEDIUM: TourStep[] = [
  {
    route: "/",
    selector: [".tower-card", ".hero"],
    perm: "staff",
    title: "Home: the control tower",
    body: "Critical, attention and in-progress work for the whole team on one screen: late orders, quotations and purchases waiting for approval, overdue invoices, expiring batches.",
    who: "Managers every morning; each person sees their own part.",
    why: "Problems are seen and handled before a customer complains.",
  },
  {
    route: "/sales",
    selector: [".stat-grid", ...HEAD],
    perm: "seeSales",
    title: "Sales: requests, quotations and orders",
    body: "Client requests (RFQs) become quotations, quotations become orders. Large quotations, low margins or big discounts go to a manager for approval first.",
    who: "Sales team and sales manager.",
    why: "Every request is answered on time, and no quotation goes out below your minimum margin.",
  },
  {
    route: "/clients",
    selector: [".rec-list", ...HEAD],
    title: "Customers, credit limits and terms",
    body: "Give each corporate customer a credit limit and payment terms (for example 30 days). When an invoice would take them over the limit, a manager must approve it.",
    who: "Sales and finance.",
    why: "You keep selling on credit without letting unpaid balances grow out of control.",
  },
  {
    route: "/supplier-rfqs",
    selector: [".tabs-row", ".rec-list", ...HEAD],
    perm: "seePurchasing",
    title: "Supplier quotations and comparison",
    body: "Ask two or three suppliers for prices on the same items, enter their answers, then compare price, lead time and terms side by side. Award the best one and the purchase order is created for you.",
    who: "Procurement officer.",
    why: "You buy at the best price and can show why each supplier was chosen.",
  },
  {
    route: "/purchase-orders",
    selector: [".tabs-row", ...HEAD],
    perm: "seePurchasing",
    title: "Purchase orders and approvals",
    body: "Purchase orders above your limit wait for a manager's approval. Nobody can approve their own. Then send the PO to the supplier and record their confirmation.",
    who: "Procurement officer; managers approve.",
    why: "Spending is controlled, and every purchase has a clear paper trail.",
  },
  {
    route: "/receiving",
    selector: [".rec-list", "main.page h1"],
    perm: "receiveGoods",
    title: "Goods received notes (GRN)",
    body: "When goods arrive, the storekeeper checks them against the purchase order and records what came, with batch numbers and expiry dates. Stock goes up automatically.",
    who: "Storekeeper.",
    why: "You only pay for what really arrived, and stock is always correct.",
  },
  {
    route: "/stock",
    selector: [".store-card", ".stat-grid", ...HEAD],
    perm: "seeStock",
    title: "Several stores, batches and expiry",
    body: "See stock per store and per batch. Chemicals and lubricants carry expiry dates; LeMoSp warns you before a batch expires and sends the oldest stock out first.",
    who: "Storekeepers and procurement.",
    why: "Less expired stock thrown away, and you know exactly where every item is.",
  },
  {
    route: "/receivables",
    selector: [".stat-grid", "main.page h1"],
    perm: "seeFinance",
    title: "Money owed to us",
    body: "Every customer's balance by age: current, 1–30, 31–60, 61–90 and over 90 days. Reminders go out at each step.",
    who: "Finance team and managers.",
    why: "Cash comes in faster and you see risky customers early.",
  },
  {
    route: "/payables",
    selector: [".stat-grid", "main.page h1"],
    perm: "seeFinance",
    title: "Supplier bills and what we owe",
    body: "Record each supplier's invoice against its purchase order, then the payments you make. See totals per currency and what is due soon.",
    who: "Finance team.",
    why: "You pay suppliers on time, keep good terms and never pay the same bill twice.",
  },
  {
    route: "/profit",
    selector: [".stat-grid", ".tabs-row", "main.page h1"],
    perm: "seeProfit",
    title: "Profit by order, customer and industry",
    body: "See the real profit of each order after supplier cost, freight and other costs, then by customer, by industry (mining, cement, sugar…) and by salesperson.",
    who: "Owner and managers.",
    why: "You learn which customers and products really make you money.",
  },
  {
    route: "/settings/team",
    selector: ["main.page h1", ...HEAD],
    perm: "manager",
    title: "Team roles and approvals",
    body: "Invite each person with a role: sales, procurement, warehouse, driver, finance or management. Each role sees only what it needs. Approval limits are set in Company details.",
    who: "Owner or general manager.",
    why: "Everyone works in the same system, safely, and you know who did what.",
  },
  {
    route: "/growth",
    selector: [".grow-level", ...HEAD],
    feature: null,
    title: "Growth and recommendations",
    body: "As the business grows, LeMoSp suggests Enterprise tools with the reason why. Switch on single features or change level at any time; no data is ever lost.",
    who: "The owner.",
    why: "The system grows with the company instead of being replaced.",
  },
];

const ENTERPRISE: TourStep[] = [
  {
    route: "/",
    selector: [".tower-card", ".hero"],
    perm: "staff",
    title: "The control tower",
    body: "One screen for the whole group: critical issues, items needing attention and work in progress across sales, procurement, stores, deliveries and finance.",
    who: "Directors and department heads.",
    why: "No need to open twenty modules every morning to know where the business stands.",
  },
  {
    route: "/",
    selector: [".stats-block", ".carousel", ".quick-grid"],
    perm: "staff",
    title: "Statistics at a glance",
    body: "Swipe through key figures: sales trend, money owed by age, sales by industry and top customers. Each chart opens the full report.",
    who: "Management.",
    why: "Decisions are based on current numbers, not last month's spreadsheet.",
  },
  {
    route: "/warehouses",
    selector: ["main.page .card", "main.page h1"],
    perm: "manager",
    title: "Stores across regions",
    body: "Run stores in Dar es Salaam, Mwanza, Geita, Mbeya or anywhere else from one system. Each receipt, adjustment and delivery records its store.",
    who: "Operations manager and storekeepers.",
    why: "Head office sees stock in every region without phone calls.",
  },
  {
    route: "/stock",
    selector: [".stat-grid", ".store-card", ...HEAD],
    perm: "seeStock",
    title: "Stock valuation",
    body: "The value of stock in every store and batch, items below reorder level and batches close to expiry, all in one view.",
    who: "Finance and operations.",
    why: "You know how much money is tied up in stock and where to free it.",
  },
  {
    route: "/purchasing",
    selector: [".stat-grid", ...HEAD],
    perm: "seePurchasing",
    title: "Advanced procurement",
    body: "Supplier quotations, side-by-side comparison, purchase orders with approval limits, goods received and supplier bills, all linked to the customer order they serve.",
    who: "Procurement department.",
    why: "Lower buying costs and a full audit trail for every shilling spent.",
  },
  {
    route: "/purchase-orders",
    selector: [".rec-list", ...HEAD],
    perm: "seePurchasing",
    title: "Landed cost on imports",
    body: "On an import purchase order, add freight, insurance, duty, clearing, port charges and transport. LeMoSp spreads them over the items to give the true landed cost.",
    who: "Procurement and finance.",
    why: "Your selling prices and margins are based on the real cost, not just the supplier's price.",
  },
  {
    route: "/rates",
    selector: ["main.page .card", "main.page h1"],
    perm: "seeFinance",
    title: "Multiple currencies",
    body: "Buy in USD, EUR or ZAR and sell in TZS. Each document keeps the exchange rate used on its date.",
    who: "Finance team.",
    why: "Exchange-rate gains and losses are visible instead of hidden in totals.",
  },
  {
    route: "/profit",
    selector: [".stat-grid", ".tabs-row", "main.page h1"],
    perm: "seeProfit",
    title: "Profit analytics",
    body: "Gross profit by order, customer, industry and salesperson, month by month.",
    who: "Directors and finance.",
    why: "Put your effort where the margin is, and fix loss-making lines early.",
  },
  {
    route: "/activity",
    selector: ["main.page .list", "main.page h1"],
    perm: "manager",
    title: "Activity log (audit trail)",
    body: "Every important change is recorded: who changed a price, who approved a purchase order, when and from what to what.",
    who: "Management and auditors.",
    why: "Nobody can silently change financial records, which protects the company and honest staff.",
  },
  {
    route: "/settings/security",
    selector: ["main.page h1", ...HEAD],
    perm: "manager",
    title: "Security and two-step policy",
    body: "Require two-step verification for everyone, set automatic sign-out after idle time and control who can open what.",
    who: "Management and IT.",
    why: "Company data stays safe even if a password is stolen or a phone is lost.",
  },
  {
    route: "/settings/features",
    selector: [".feat-summary", ...HEAD],
    perm: "manager",
    title: "Business level and feature switches",
    body: "Your level sets the default tools. Any single feature can still be switched on or off for your company.",
    who: "Owner or general manager.",
    why: "Each department gets exactly the tools it needs, no more and no less.",
  },
  {
    route: "/growth",
    selector: [".feat.soon", ".grow-level", ...HEAD],
    feature: null,
    title: "Coming soon for Enterprise",
    body: "Branches with head-office reports, budgets against actual, cash-flow and demand forecasting are being built. They appear on the Growth page as \"Coming soon\" and switch on when ready.",
    who: "Directors.",
    why: "You can plan today knowing where the platform is going.",
  },
];

export const TOURS: Record<TourId, Tour> = {
  small: { id: "small", title: "Small business tour", steps: SMALL },
  medium: { id: "medium", title: "Medium business tour", steps: MEDIUM },
  enterprise: { id: "enterprise", title: "Enterprise tour", steps: ENTERPRISE },
};

export function isTourId(v: unknown): v is TourId {
  return isLevel(v);
}

export type TourFilter = {
  /** Feature keys switched off for the company. */
  off: string[];
  role: Role;
};

/** May this person see this step? (feature switched on and their role can open the screen). */
export function stepAllowed(step: TourStep, filter: TourFilter): boolean {
  const feature = step.feature === undefined ? featureForRoute(step.route) : step.feature;
  if (feature && filter.off.includes(feature)) return false;
  const p = step.perm;
  if (!p) return true;
  if (p === "manager") return filter.role === "management";
  if (p === "staff") return filter.role !== "driver";
  return can(filter.role, p);
}

/** The steps of a tour that make sense for this company and person. */
export function tourSteps(id: TourId, filter: TourFilter): TourStep[] {
  return TOURS[id].steps.filter((s) => stepAllowed(s, filter));
}
