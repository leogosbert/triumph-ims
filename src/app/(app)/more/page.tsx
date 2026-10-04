import { primeLang, tr } from "@/lib/tr";
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
  await primeLang();
  const { role, isManager } = await getAppContext();
  const addClient = can(role, "editClients");
  const addSupplier = can(role, "editSuppliers");
  const addProduct = can(role, "editProducts");

  return (
    <>
      <h1>{tr("More")}</h1>

      {(addClient || addSupplier || addProduct) && (
        <>
          <h2>{tr("Add new records")}</h2>
          <p className="muted small">{tr("Fill in a form directly in the app, one record at a time.")}</p>
          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            {addClient && <Tile href="/clients/new" title={tr("+ New client")} sub={tr("Company, industry, TIN/VRN, sites, terms")} />}
            {addSupplier && (
              <Tile href="/suppliers/new" title={tr("+ New supplier")} sub={tr("Contact, country, currency, lead time, terms")} />
            )}
            {addProduct && (
              <Tile href="/products/new" title={tr("+ New product")} sub={tr("SKU, brand, part number, unit, price, safety")} />
            )}
          </div>
        </>
      )}

      <h2>{tr("Records")}</h2>
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Tile href="/clients" title={tr("Clients")} sub={tr("Search, view and edit clients and their contacts")} />
        {can(role, "seeSuppliers") && <Tile href="/suppliers" title={tr("Suppliers")} sub={tr("Search, view and edit suppliers")} />}
        <Tile href="/products" title={tr("Products")} sub={tr("Search, view and edit the catalogue")} />
        {can(role, "seeSales") && <Tile href="/sales" title={tr("Sales")} sub={tr("Client RFQs, quotations, approvals")} />}
        {can(role, "seePurchasing") && <Tile href="/purchasing" title={tr("Purchasing")} sub={tr("Supplier RFQs and purchase orders")} />}
        {can(role, "seeFinance") && <Tile href="/finance" title={tr("Finance")} sub={tr("Invoices, payments, money owed, profit")} />}
        {!can(role, "seeFinance") && can(role, "seeInvoices") && <Tile href="/invoices" title={tr("Invoices")} sub={tr("Invoices and what clients owe")} />}
        {!can(role, "seeFinance") && can(role, "seeBills") && <Tile href="/bills" title={tr("Supplier bills")} sub={tr("Suppliers' invoices and payments")} />}
        {can(role, "seeStock") && <Tile href="/stock" title={tr("Stock")} sub={tr("Stock on hand, batches, expiry, adjustments")} />}
        {can(role, "receiveGoods") && <Tile href="/receiving" title={tr("Receive goods")} sub={tr("Record goods arriving against purchase orders")} />}
        {can(role, "seeDeliveries") && <Tile href="/deliveries" title={tr("Deliveries")} sub={tr("Delivery notes and proof of delivery")} />}
        {role === "driver" && <Tile href="/driver" title={tr("My deliveries")} sub={tr("Deliveries assigned to you, record proof of delivery")} />}
        {can(role, "manageWarehouses") && <Tile href="/warehouses" title={tr("Stores")} sub={tr("Warehouses and store locations")} />}
        {can(role, "importData") && (
          <Tile href="/import" title={tr("Import from spreadsheet")} sub={tr("Load many records at once from the template")} />
        )}
      </div>

      <h2>{tr("Company")}</h2>
      <div className="grid grid-2">
        <Tile
          href="/settings/company"
          title={tr("Company details & branding")}
          sub={isManager ? tr("Name, TIN, VRN, logo, colours, bank details") : tr("View the company's details")}
        />
        {isManager && <Tile href="/settings/team" title={tr("Team & roles")} sub={tr("Invite people, change roles")} />}
        {isManager && <Tile href="/activity" title={tr("Activity log")} sub={tr("Every change, who made it and when")} />}
        <Tile href="/help" title={tr("Help")} sub={tr("Short guide for your role, step by step")} />
        {isManager && <Tile href="/settings/go-live" title={tr("Go-live checklist")} sub={tr("What is ready and what is left")} />}
        <Tile href="/notifications" title={tr("Notifications")} sub={tr("Your alerts, phone notifications and emails")} />
        {isManager && <Tile href="/settings/notifications" title={tr("Alerts setup")} sub={tr("Connect phone push and email sending")} />}
        <Tile href="/account" title={tr("Your account")} sub={tr("Your details, password, sign out")} />
      </div>
      <a className="lemo-foot" href="/help">
        <img src="/brand/lemo-ims.svg" alt={tr("LeMo IMS")} />
        <span>{tr("a LeMo Tech Solutions product")}</span>
      </a>
    </>
  );
}
