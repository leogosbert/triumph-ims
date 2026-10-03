import Link from "next/link";
import { Notice } from "@/components/Notice";
import { displayName, getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";

export const metadata = { title: "Home" };

const COMING = [
  { title: "RFQs & quotations", sub: "Client requests, priced quotes, PDF, approvals", stage: 3 },
  { title: "Purchasing", sub: "Supplier RFQs, comparison, purchase orders", stage: 4 },
  { title: "Stock & deliveries", sub: "Goods received, stock, delivery notes, proof of delivery", stage: 5 },
  { title: "Invoices & payments", sub: "Invoices, receipts, money owed, profit per order", stage: 6 },
  { title: "Dashboard & alerts", sub: "Control tower, notifications, email", stage: 7 },
];

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(
      new Date(),
    ),
  );
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { supabase, profile, company, role, isManager } = await getAppContext();
  const firstName = displayName(profile).split(" ")[0];

  let checklist: { done: boolean; label: string; href: string }[] = [];
  if (isManager) {
    const [{ count: members }, { count: invites }, { count: clientCount }] = await Promise.all([
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("company_id", company.id),
      supabase.from("invitations").select("id", { count: "exact", head: true }).eq("company_id", company.id),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    ]);
    checklist = [
      {
        done: Boolean(company.tin && company.address && company.phone),
        label: "Add company details (TIN, address, phone)",
        href: "/settings/company",
      },
      { done: Boolean(company.logo_path), label: "Upload your logo and set your colours", href: "/settings/company#branding" },
      { done: Boolean(company.bank_details), label: "Add bank details for quotations and invoices", href: "/settings/company#documents" },
      { done: (members ?? 0) > 1 || (invites ?? 0) > 0, label: "Invite your team", href: "/settings/team" },
      { done: (clientCount ?? 0) > 0, label: "Load your clients, suppliers and products", href: "/import" },
    ];
  }
  const remaining = checklist.filter((c) => !c.done).length;

  return (
    <>
      <Notice {...notice} />
      <h1>
        {greeting()}, {firstName}
      </h1>
      <p className="muted">Here&apos;s where {company.name} stands.</p>

      {isManager && remaining > 0 && (
        <section className="card">
          <h2>Set up checklist</h2>
          <p className="muted small">{remaining} of {checklist.length} left. These appear on your quotations and invoices.</p>
          <ul className="list checklist">
            {checklist.map((c) => (
              <li key={c.label}>
                <span className={c.done ? "tick" : "todo"} aria-hidden="true">
                  {c.done ? "✓" : "○"}
                </span>
                {c.done ? <span className="muted">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 style={{ marginTop: 8 }}>Records</h2>
      <div className="grid grid-2">
        <Link href="/clients" className="tile">
          <div className="tile-title">Clients</div>
          <div className="tile-sub">Companies you sell to, their sites and contacts</div>
        </Link>
        {can(role, "seeSuppliers") && (
          <Link href="/suppliers" className="tile">
            <div className="tile-title">Suppliers</div>
            <div className="tile-sub">Who you buy from, terms and lead times</div>
          </Link>
        )}
        <Link href="/products" className="tile">
          <div className="tile-title">Products</div>
          <div className="tile-sub">Catalogue, prices and technical details</div>
        </Link>
        {can(role, "importData") && (
          <Link href="/import" className="tile">
            <div className="tile-title">Import from spreadsheet</div>
            <div className="tile-sub">Load the master data template in one go</div>
          </Link>
        )}
      </div>

      <h2 style={{ marginTop: 24 }}>Coming next</h2>
      <div className="grid grid-2">
        {COMING.map((m) => (
          <div key={m.title} className="tile soon">
            <div className="row">
              <span className="tile-title">{m.title}</span>
              <span className="badge off">Stage {m.stage}</span>
            </div>
            <div className="tile-sub">{m.sub}</div>
          </div>
        ))}
      </div>
    </>
  );
}
