import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { can } from "@/lib/roles";

export const metadata = { title: "More" };

function Tile({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="tile">
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{sub}</div>
    </Link>
  );
}

export default async function MorePage() {
  const { role, isManager } = await getAppContext();
  const addClient = can(role, "editClients");
  const addSupplier = can(role, "editSuppliers");
  const addProduct = can(role, "editProducts");

  return (
    <>
      <h1>More</h1>

      {(addClient || addSupplier || addProduct) && (
        <>
          <h2>Add new records</h2>
          <p className="muted small">Fill in a form directly in the app, one record at a time.</p>
          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            {addClient && <Tile href="/clients/new" title="+ New client" sub="Company, industry, TIN/VRN, sites, terms" />}
            {addSupplier && (
              <Tile href="/suppliers/new" title="+ New supplier" sub="Contact, country, currency, lead time, terms" />
            )}
            {addProduct && (
              <Tile href="/products/new" title="+ New product" sub="SKU, brand, part number, unit, price, safety" />
            )}
          </div>
        </>
      )}

      <h2>Records</h2>
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Tile href="/clients" title="Clients" sub="Search, view and edit clients and their contacts" />
        {can(role, "seeSuppliers") && <Tile href="/suppliers" title="Suppliers" sub="Search, view and edit suppliers" />}
        <Tile href="/products" title="Products" sub="Search, view and edit the catalogue" />
        {can(role, "seeSales") && <Tile href="/sales" title="Sales" sub="Client RFQs, quotations, approvals" />}
        {can(role, "seePurchasing") && <Tile href="/purchasing" title="Purchasing" sub="Supplier RFQs and purchase orders" />}
        {can(role, "seeFinance") && <Tile href="/finance" title="Finance" sub="Invoices, payments, money owed, profit" />}
        {!can(role, "seeFinance") && can(role, "seeInvoices") && <Tile href="/invoices" title="Invoices" sub="Invoices and what clients owe" />}
        {!can(role, "seeFinance") && can(role, "seeBills") && <Tile href="/bills" title="Supplier bills" sub="Suppliers' invoices and payments" />}
        {can(role, "seeStock") && <Tile href="/stock" title="Stock" sub="Stock on hand, batches, expiry, adjustments" />}
        {can(role, "receiveGoods") && <Tile href="/receiving" title="Receive goods" sub="Record goods arriving against purchase orders" />}
        {can(role, "seeDeliveries") && <Tile href="/deliveries" title="Deliveries" sub="Delivery notes and proof of delivery" />}
        {role === "driver" && <Tile href="/driver" title="My deliveries" sub="Deliveries assigned to you, record proof of delivery" />}
        {can(role, "manageWarehouses") && <Tile href="/warehouses" title="Stores" sub="Warehouses and store locations" />}
        {can(role, "importData") && (
          <Tile href="/import" title="Import from spreadsheet" sub="Load many records at once from the template" />
        )}
      </div>

      <h2>Company</h2>
      <div className="grid grid-2">
        <Tile
          href="/settings/company"
          title="Company details & branding"
          sub={isManager ? "Name, TIN, VRN, logo, colours, bank details" : "View the company's details"}
        />
        {isManager && <Tile href="/settings/team" title="Team & roles" sub="Invite people, change roles" />}
        {isManager && <Tile href="/activity" title="Activity log" sub="Every change, who made it and when" />}
        <Tile href="/notifications" title="Notifications" sub="Your alerts, phone notifications and emails" />
        {isManager && <Tile href="/settings/notifications" title="Alerts setup" sub="Connect phone push and email sending" />}
        <Tile href="/account" title="Your account" sub="Your details, password, sign out" />
      </div>
    </>
  );
}
