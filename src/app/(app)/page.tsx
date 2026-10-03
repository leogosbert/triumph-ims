import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { displayName, getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Home" };

const COMING = [
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
  const { supabase, profile, company, role, isManager, user } = await getAppContext();
  if (role === "driver") redirect("/driver");
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

  type Pending = { id: string; number: string; revision: number; total: number; currency: string; client: { name: string } | null };
  let approvals: Pending[] = [];
  if (can(role, "approveQuotes")) {
    const { data } = await supabase
      .from("quotations")
      .select("id, number, revision, total, currency, submitted_by, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .neq("submitted_by", user.id)
      .order("submitted_at")
      .limit(10);
    approvals = (data ?? []) as unknown as Pending[];
  }
  type PendingPo = { id: string; number: string; total: number; currency: string; supplier: { name: string } | null };
  let poApprovals: PendingPo[] = [];
  if (can(role, "approvePOs")) {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, number, total, currency, supplier:suppliers(name)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .neq("submitted_by", user.id)
      .order("submitted_at")
      .limit(10);
    poApprovals = (data ?? []) as unknown as PendingPo[];
  }

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

      {approvals.length > 0 && (
        <section className="card" style={{ borderColor: "#f0d49a" }}>
          <h2>Quotations waiting for your approval</h2>
          <ul className="list">
            {approvals.map((q) => (
              <li key={q.id} className="row">
                <Link href={`/quotations/${q.id}`}>
                  {q.client?.name ?? "Client"} · {q.revision > 0 ? `${q.number}-R${q.revision}` : q.number}
                </Link>
                <span className="small">{formatMoney(q.total, q.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {poApprovals.length > 0 && (
        <section className="card" style={{ borderColor: "#f0d49a" }}>
          <h2>Purchase orders waiting for your approval</h2>
          <ul className="list">
            {poApprovals.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/purchase-orders/${p.id}`}>
                  {p.supplier?.name ?? "Supplier"} · {p.number}
                </Link>
                <span className="small">{formatMoney(p.total, p.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 style={{ marginTop: 8 }}>Work</h2>
      <div className="grid grid-2">
        {can(role, "seeSales") && (
          <Link href="/sales" className="tile">
            <div className="tile-title">Sales</div>
            <div className="tile-sub">Client RFQs, quotations and approvals</div>
          </Link>
        )}
        {can(role, "seePurchasing") && (
          <Link href="/purchasing" className="tile">
            <div className="tile-title">Purchasing</div>
            <div className="tile-sub">Supplier RFQs, price comparison, purchase orders</div>
          </Link>
        )}
        {can(role, "seeStock") && (
          <Link href="/stock" className="tile">
            <div className="tile-title">Stock</div>
            <div className="tile-sub">What is in the store, batches and expiry dates</div>
          </Link>
        )}
        {can(role, "receiveGoods") && (
          <Link href="/receiving" className="tile">
            <div className="tile-title">Receive goods</div>
            <div className="tile-sub">Purchase orders waiting for delivery, goods received notes</div>
          </Link>
        )}
        {can(role, "seeDeliveries") && (
          <Link href="/deliveries" className="tile">
            <div className="tile-title">Deliveries</div>
            <div className="tile-sub">Delivery notes, drivers, proof of delivery</div>
          </Link>
        )}
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
