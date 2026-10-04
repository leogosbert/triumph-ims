import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { ThemePicker } from "@/components/ThemePicker";
import { getAppContext } from "@/lib/context";
import { featureForRoute } from "@/lib/features";
import { APP_VERSION, BUILD_ID } from "@/lib/releases";
import { can } from "@/lib/roles";

export const metadata = { title: "More" };

const ICONS: Record<string, IconName> = {
  "/clients/new": "plus",
  "/suppliers/new": "plus",
  "/products/new": "plus",
  "/clients": "clients",
  "/suppliers": "truck",
  "/products": "products",
  "/sales": "sales",
  "/purchasing": "purchasing",
  "/finance": "finance",
  "/invoices": "receipt",
  "/bills": "receipt",
  "/stock": "stock",
  "/receiving": "inbox",
  "/deliveries": "deliveries",
  "/driver": "deliveries",
  "/warehouses": "warehouse",
  "/import": "upload",
  "/settings/company": "building",
  "/settings/team": "team",
  "/activity": "activity",
  "/help": "help",
  "/settings/go-live": "check",
  "/notifications": "bell",
  "/settings/notifications": "settings",
  "/account": "user",
  "/suggestions": "inbox",
  "/growth": "activity",
  "/settings/features": "check",
  "/admin": "settings",
};

function Tile({ href, title, sub, show = true }: { href: string; title: string; sub: string; show?: boolean }) {
  if (!show) return null;
  return (
    <Link href={href} className="tile tile-icon">
      <span className="tile-ico" aria-hidden>
        <Icon name={ICONS[href] ?? "doc"} size={20} />
      </span>
      <span className="tile-body">
        <span className="tile-title">{title}</span>
        <span className="tile-sub">{sub}</span>
      </span>
    </Link>
  );
}

export default async function MorePage() {
  await primeLang();
  const { role, isManager, features, isPlatformAdmin } = await getAppContext();
  // A tile is shown only when its feature is switched on (drivers always keep /driver).
  const on = (href: string) => (role === "driver" && href === "/driver") || features.on(featureForRoute(href));
  const addClient = can(role, "editClients") && on("/clients/new");
  const addSupplier = can(role, "editSuppliers") && on("/suppliers/new");
  const addProduct = can(role, "editProducts") && on("/products/new");

  return (
    <>
      <h1>{tr("More")}</h1>

      {(addClient || addSupplier || addProduct) && (
        <>
          <h2>{tr("Add new records")}</h2>
          <p className="muted small">{tr("Fill in a form directly in the app, one record at a time.")}</p>
          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            {addClient && <Tile show={on("/clients/new")} href="/clients/new" title={tr("+ New client")} sub={tr("Company, industry, TIN/VRN, sites, terms")} />}
            {addSupplier && (
              <Tile show={on("/suppliers/new")} href="/suppliers/new" title={tr("+ New supplier")} sub={tr("Contact, country, currency, lead time, terms")} />
            )}
            {addProduct && (
              <Tile show={on("/products/new")} href="/products/new" title={tr("+ New product")} sub={tr("SKU, brand, part number, unit, price, safety")} />
            )}
          </div>
        </>
      )}

      <h2>{tr("Records")}</h2>
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Tile show={on("/clients")} href="/clients" title={tr("Clients")} sub={tr("Search, view and edit clients and their contacts")} />
        {can(role, "seeSuppliers") && <Tile show={on("/suppliers")} href="/suppliers" title={tr("Suppliers")} sub={tr("Search, view and edit suppliers")} />}
        <Tile show={on("/products")} href="/products" title={tr("Products")} sub={tr("Search, view and edit the catalogue")} />
        {can(role, "seeSales") && <Tile show={on("/sales")} href="/sales" title={tr("Sales")} sub={tr("Client RFQs, quotations, approvals")} />}
        {can(role, "seePurchasing") && <Tile show={on("/purchasing")} href="/purchasing" title={tr("Purchasing")} sub={tr("Supplier RFQs and purchase orders")} />}
        {can(role, "seeFinance") && <Tile show={on("/finance")} href="/finance" title={tr("Finance")} sub={tr("Invoices, payments, money owed, profit")} />}
        {!can(role, "seeFinance") && can(role, "seeInvoices") && <Tile show={on("/invoices")} href="/invoices" title={tr("Invoices")} sub={tr("Invoices and what clients owe")} />}
        {!can(role, "seeFinance") && can(role, "seeBills") && <Tile show={on("/bills")} href="/bills" title={tr("Supplier bills")} sub={tr("Suppliers' invoices and payments")} />}
        {can(role, "seeStock") && <Tile show={on("/stock")} href="/stock" title={tr("Stock")} sub={tr("Stock on hand, batches, expiry, adjustments")} />}
        {can(role, "receiveGoods") && <Tile show={on("/receiving")} href="/receiving" title={tr("Receive goods")} sub={tr("Record goods arriving against purchase orders")} />}
        {can(role, "seeDeliveries") && <Tile show={on("/deliveries")} href="/deliveries" title={tr("Deliveries")} sub={tr("Delivery notes and proof of delivery")} />}
        {role === "driver" && <Tile show={on("/driver")} href="/driver" title={tr("My deliveries")} sub={tr("Deliveries assigned to you, record proof of delivery")} />}
        {can(role, "manageWarehouses") && <Tile show={on("/warehouses")} href="/warehouses" title={tr("Stores")} sub={tr("Warehouses and store locations")} />}
        {can(role, "importData") && (
          <Tile show={on("/import")} href="/import" title={tr("Import from spreadsheet")} sub={tr("Load many records at once from the template")} />
        )}
      </div>

      <h2>{tr("Company")}</h2>
      <div className="grid grid-2">
        <Tile
          href="/settings/company"
          title={tr("Company details & branding")}
          sub={isManager ? tr("Name, TIN, VRN, logo, colours, bank details") : tr("View the company's details")}
        />
        {isManager && <Tile show={on("/settings/team")} href="/settings/team" title={tr("Team & roles")} sub={tr("Invite people, change roles")} />}
        {isManager && <Tile show={on("/activity")} href="/activity" title={tr("Activity log")} sub={tr("Every change, who made it and when")} />}
        <Tile show={on("/help")} href="/help" title={tr("Help")} sub={tr("Short guide for your role, step by step")} />
        {isManager && <Tile show={on("/settings/go-live")} href="/settings/go-live" title={tr("Go-live checklist")} sub={tr("What is ready and what is left")} />}
        <Tile show={on("/notifications")} href="/notifications" title={tr("Notifications")} sub={tr("Your alerts, phone notifications and emails")} />
        {isManager && <Tile show={on("/settings/notifications")} href="/settings/notifications" title={tr("Alerts setup")} sub={tr("Connect phone push and email sending")} />}
        <Tile show={on("/account")} href="/account" title={tr("Your account")} sub={tr("Your details, password, sign out")} />
      </div>

      <h2 style={{ marginTop: 24 }}>{tr("Grow & improve")}</h2>
      <div className="grid grid-2">
        <Tile show={on("/suggestions")} href="/suggestions" title={tr("Suggestion Box")} sub={tr("Share an idea to improve the business")} />
        {isManager && (
          <Tile href="/growth" title={tr("Growth & recommendations")} sub={tr("Your business level and features that could help")} />
        )}
        {!isManager && <Tile href="/growth" title={tr("Your business level")} sub={tr("See the tools your company uses and what comes next")} />}
        {isManager && (
          <Tile href="/settings/features" title={tr("Features & business level")} sub={tr("Switch features on or off, change your level")} />
        )}
        {isPlatformAdmin && <Tile href="/admin" title={tr("Platform admin")} sub={tr("LeMo Tech: companies, features, feedback")} />}
      </div>
      <h2 style={{ marginTop: 24 }}>{tr("Appearance")}</h2>
      <p className="muted small">{tr("Auto follows your phone's light or dark setting.")}</p>
      <ThemePicker />

      <a className="lemo-foot" href="/help">
        <img src="/brand/lemosp.svg" alt={tr("LeMoSp")} />
        <span>{tr("a LeMo Tech Solutions product")}</span>
        <span className="lemo-ver">v{APP_VERSION}{BUILD_ID ? ` · ${BUILD_ID.slice(0, 7)}` : ""}</span>
      </a>
    </>
  );
}
