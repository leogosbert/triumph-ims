import { APP_VERSION, BUILD_ID } from "@/lib/releases";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { TourButton } from "@/components/tour/TourButton";
import { LEVELS, type Level } from "@/lib/levels";

export const metadata = { title: "Help" };

type Guide = { role: Role; intro: string; steps: { title: string; text: string; href?: string }[] };

const GUIDES: Guide[] = [
  {
    role: "sales",
    intro: "You turn client requests into won orders.",
    steps: [
      { title: "Log every request", text: "When a client asks for prices (email, phone, WhatsApp, visit), create a client RFQ with the items and due date. You get a reminder when it is due.", href: "/rfqs/new" },
      { title: "Quote", text: "From the RFQ press Create quotation. Pick products from the catalogue, set prices and discounts, check delivery time and payment terms.", href: "/quotations" },
      { title: "Submit", text: "Submit sends it for approval when it is large, has a low margin or a big discount; otherwise it is approved straight away. You are told when management decides." },
      { title: "Send", text: "Share PDF sends the quotation by WhatsApp or email from your phone. Then press I have sent it to the client." },
      { title: "Record the answer", text: "When the client replies, press Client accepted (add their PO number) or Client declined. Accepted orders go to procurement automatically." },
      { title: "Follow up", text: "The bell tells you when quotations are about to expire, when goods arrive and when the client pays." },
    ],
  },
  {
    role: "procurement",
    intro: "You buy the goods at the best price and make sure they arrive on time.",
    steps: [
      { title: "Won orders", text: "You are told when an order is won. Open it and press Request supplier quotes, or Create purchase order if you already know the supplier." },
      { title: "Compare suppliers", text: "Invite 2–3 suppliers, share the RFQ PDF with each, enter their prices when they reply, then Compare prices and Award & create PO." },
      { title: "Purchase order", text: "Check the PO, Submit (large POs go to management), share the PDF with the supplier, then Supplier confirmed with their order number." },
      { title: "Import costs", text: "On the PO add duty, clearing, port charges and freight, then Use landed cost as product cost so margins are real." },
      { title: "Chase late orders", text: "The bell warns you when an expected delivery date passes, and when stock falls below the reorder level." },
    ],
  },
  {
    role: "warehouse",
    intro: "You receive goods, keep stock right, and send deliveries out.",
    steps: [
      { title: "Receive goods", text: "Receive goods lists POs waiting for delivery. Enter what arrived, with batch numbers and expiry dates for chemicals and lubricants.", href: "/receiving" },
      { title: "Check stock", text: "Stock shows quantities per store and batch, expiring batches and items below reorder level. Adjust stock after counts (a reason is required).", href: "/stock" },
      { title: "Deliver", text: "Open the delivery note (from the accepted order), set store, site, driver and vehicle, then Dispatch. Stock goes out oldest-expiry first.", href: "/deliveries" },
      { title: "Print", text: "Share PDF prints the delivery note for the truck. After delivery it becomes the signed proof of delivery." },
    ],
  },
  {
    role: "driver",
    intro: "You deliver the goods and record proof of delivery on your phone.",
    steps: [
      { title: "Before you leave", text: "Open My deliveries while you have signal, so the list is saved on your phone.", href: "/driver" },
      { title: "At the site", text: "Press Record delivery. Type the receiver's name, ask them to sign on the screen, take a photo of the goods, then Confirm delivery." },
      { title: "No signal?", text: "It is saved on your phone and sent automatically when you have signal again. You can also press Send now." },
      { title: "Could not deliver", text: "Choose Could not deliver and say why. The goods go back into stock." },
    ],
  },
  {
    role: "finance",
    intro: "You invoice, collect money, pay suppliers and watch profit.",
    steps: [
      { title: "Invoice deliveries", text: "You are told when a delivery is completed. Open it and press Create invoice, check it, then Issue invoice and share the PDF.", href: "/invoices/new" },
      { title: "Record payments", text: "On the invoice, Record a payment received (part or full). Each payment has a receipt PDF." },
      { title: "Chase money", text: "Money owed to us shows every client by how late they are. The bell reminds you at 1, 30, 60 and 90 days overdue.", href: "/receivables" },
      { title: "Pay suppliers", text: "Record each supplier's invoice from its PO, then record payments. Money we owe shows totals per currency.", href: "/bills" },
      { title: "Exchange rates", text: "Keep the company USD/EUR rates up to date. Documents in foreign currency use them automatically.", href: "/rates" },
      { title: "Profit", text: "Profit shows the month by order, client, industry and salesperson.", href: "/profit" },
    ],
  },
  {
    role: "management",
    intro: "You see everything, approve, and keep the system set up.",
    steps: [
      { title: "Start each day on Home", text: "The control tower shows what is critical, what needs attention and what is in progress. Every line opens the list behind it.", href: "/" },
      { title: "Approve", text: "Quotations and POs above the limits wait for you (you are told on the bell and phone). Nobody can approve their own." },
      { title: "Limits and terms", text: "Company details sets VAT, approval limits, minimum margin, payment days and the standard terms on documents.", href: "/settings/company" },
      { title: "Team", text: "Invite people with the right role; switch access off the day someone leaves.", href: "/settings/team" },
      { title: "Credit", text: "Set credit limits on clients. Invoices above the limit need you to issue them." },
      { title: "Records and backups", text: "Activity log shows every change. Export data downloads everything at any time.", href: "/settings/export" },
    ],
  },
];

export default async function HelpPage() {
  await primeLang();
  const { role, company } = await getAppContext();
  const level: Level = company.business_level ?? "medium";
  const mine = GUIDES.find((g) => g.role === role);
  const others = GUIDES.filter((g) => g.role !== role);

  const render = (g: Guide) => (
    <ol className="help-steps">
      {g.steps.map((s) => (
        <li key={s.title}>
          <strong>{s.href ? <Link href={s.href}>{tr(String(s.title ?? ""))}</Link> : s.title}.</strong> {tr(String(s.text ?? ""))}
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <h1>{tr("Help")}</h1>
      <p className="muted small">{tr("The whole flow: client RFQ → quotation → approval → order won → supplier quotes → purchase order → goods received → delivery → proof of delivery → invoice → payment → profit. Each person does their part and the next person is told.")}</p>
      {role !== "driver" && (
        <section className="card help-tour" data-tour="help-tour">
          <div>
            <h2>{tr("Take the guided tour for your business level")}</h2>
            <p className="small muted">
              {tr(LEVELS[level].title)} · {tr("A short walk through the real screens: what each one does, who uses it and how it helps.")}
            </p>
          </div>
          <TourButton tour={level} label="Start the tour" className="btn btn-primary btn-small" />
        </section>
      )}
      {mine && (
        <section className="card">
          <h2>{tr("Your role:")}{" "}{ROLE_LABELS[mine.role]}</h2>
          <p className="small muted">{tr(String(mine.intro ?? ""))}</p>
          {render(mine)}
        </section>
      )}
      <h2>{tr("Other roles")}</h2>
      {others.map((g) => (
        <details key={g.role} className="card">
          <summary>
            <strong>{ROLE_LABELS[g.role]}</strong> <span className="small muted">— {tr(String(g.intro ?? ""))}</span>
          </summary>
          {render(g)}
        </details>
      ))}
      <section className="card">
        <h2>{tr("Tips")}</h2>
        <ul className="small">
          <li>{tr("Install the app: on Android, Chrome menu → Add to Home screen; on iPhone, Safari Share → Add to Home Screen.")}</li>
          <li>{tr("Turn on phone notifications under Notifications → This device.")}</li>
          <li>{tr("Every list has search; every document has a PDF you can share by WhatsApp or email.")}</li>
          <li>{tr("Something wrong or missing? Tell management — every change is recorded in the activity log.")}</li>
        </ul>
      </section>
      <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>
        LeMoSp v{APP_VERSION}
        {BUILD_ID ? ` · build ${BUILD_ID.slice(0, 7)}` : ""} · {tr("a LeMo Tech Solutions product")}
      </p>
    </>
  );
}
