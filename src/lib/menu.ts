import type { IconName } from "@/components/Icon";
import { can, type Role } from "@/lib/roles";

export type MenuItem = { href: string; title: string; sub: string; icon: IconName; plain?: boolean };
export type MenuCategory = { key: string; label: string; icon: IconName; items: MenuItem[] };

/**
 * Everything a person can open, grouped for the slide-up menu (phones) and the More page.
 * English text is the key; screens translate it with tr().
 */
export function moreMenu(role: Role, isManager: boolean): MenuCategory[] {
  const c = (perm: Parameters<typeof can>[1]) => can(role, perm);
  type Draft = { key: string; label: string; icon: IconName; items: (MenuItem | false)[] };
  const drafts: Draft[] = [
    {
      key: "sales",
      label: "Sales",
      icon: "sales",
      items: [
        c("seeSales") && { href: "/rfqs", title: "Client RFQs", sub: "Requests for quotation from clients", icon: "inbox" },
        c("seeSales") && { href: "/quotations", title: "Quotations", sub: "Prices sent to clients, approvals", icon: "doc" },
        { href: "/clients", title: "Clients", sub: "Search, view and edit clients and their contacts", icon: "clients" },
        c("seeSales") && { href: "/sales", title: "Sales overview", sub: "Client RFQs, quotations, approvals", icon: "sales" },
      ],
    },
    {
      key: "purchasing",
      label: "Purchasing",
      icon: "purchasing",
      items: [
        c("seePurchasing") && { href: "/supplier-rfqs", title: "Supplier RFQs", sub: "Ask suppliers for prices and compare", icon: "inbox" },
        c("seePurchasing") && { href: "/purchase-orders", title: "Purchase orders", sub: "Orders to suppliers, approvals", icon: "doc" },
        c("seeSuppliers") && { href: "/suppliers", title: "Suppliers", sub: "Search, view and edit suppliers", icon: "truck" },
        c("receiveGoods") && { href: "/receiving", title: "Receive goods", sub: "Record goods arriving against purchase orders", icon: "inbox" },
        c("seePurchasing") && { href: "/purchasing", title: "Purchasing overview", sub: "Supplier RFQs and purchase orders", icon: "purchasing" },
      ],
    },
    {
      key: "stock",
      label: "Stock & delivery",
      icon: "stock",
      items: [
        role === "driver" && { href: "/driver", title: "My deliveries", sub: "Deliveries assigned to you, record proof of delivery", icon: "deliveries", plain: true },
        { href: "/products", title: "Products", sub: "Search, view and edit the catalogue", icon: "products" },
        c("seeStock") && { href: "/stock", title: "Stock", sub: "Stock on hand, batches, expiry, adjustments", icon: "stock" },
        c("seeDeliveries") && { href: "/deliveries", title: "Deliveries", sub: "Delivery notes and proof of delivery", icon: "deliveries" },
        c("manageWarehouses") && { href: "/warehouses", title: "Stores", sub: "Warehouses and store locations", icon: "warehouse" },
      ],
    },
    {
      key: "finance",
      label: "Finance",
      icon: "finance",
      items: [
        c("seeInvoices") && { href: "/invoices", title: "Invoices", sub: "Invoices and what clients owe", icon: "receipt" },
        c("seeFinance") && { href: "/payments", title: "Payments received", sub: "Money received from clients", icon: "cash" },
        c("seeFinance") && { href: "/receivables", title: "Money owed to us", sub: "Who owes what, and for how long", icon: "finance" },
        c("seeBills") && { href: "/bills", title: "Supplier bills", sub: "Suppliers' invoices and payments", icon: "receipt" },
        c("seeFinance") && { href: "/payables", title: "Money we owe", sub: "What we owe suppliers, and when", icon: "finance" },
        c("seeProfit") && { href: "/profit", title: "Profit", sub: "Profit by order, client and month", icon: "activity" },
        c("seeFinance") && { href: "/rates", title: "Exchange rates", sub: "Rates used for foreign-currency documents", icon: "cash" },
      ],
    },
    {
      key: "add",
      label: "Add new",
      icon: "plus",
      items: [
        c("editSales") && { href: "/rfqs/new", title: "+ New client RFQ", sub: "Record a request from a client", icon: "plus" },
        c("editSales") && { href: "/quotations/new", title: "+ New quotation", sub: "Prepare prices for a client", icon: "plus" },
        c("editPurchasing") && { href: "/purchase-orders/new", title: "+ New purchase order", sub: "Order from a supplier", icon: "plus" },
        c("editInvoices") && { href: "/invoices/new", title: "+ New invoice", sub: "Bill a client", icon: "plus" },
        c("editClients") && { href: "/clients/new", title: "+ New client", sub: "Company, industry, TIN/VRN, sites, terms", icon: "plus" },
        c("editSuppliers") && { href: "/suppliers/new", title: "+ New supplier", sub: "Contact, country, currency, lead time, terms", icon: "plus" },
        c("editProducts") && { href: "/products/new", title: "+ New product", sub: "SKU, brand, part number, unit, price, safety", icon: "plus" },
        c("importData") && { href: "/import", title: "Import from spreadsheet", sub: "Load many records at once from the template", icon: "upload" },
      ],
    },
    {
      key: "company",
      label: "Company & account",
      icon: "building",
      items: [
        {
          href: "/settings/company",
          title: "Company details & branding",
          sub: isManager ? "Name, TIN, VRN, logo, colours, bank details" : "View the company's details",
          icon: "building",
        },
        isManager && { href: "/settings/team", title: "Team & roles", sub: "Invite people, change roles", icon: "team" },
        isManager && { href: "/settings/security", title: "Security", sub: "Two-step verification, automatic sign-out, password rules", icon: "lock" },
        isManager && { href: "/activity", title: "Activity log", sub: "Every change, who made it and when", icon: "activity" },
        { href: "/notifications", title: "Notifications", sub: "Your alerts, phone notifications and emails", icon: "bell" },
        isManager && { href: "/settings/notifications", title: "Alerts setup", sub: "Connect phone push and email sending", icon: "settings" },
        isManager && { href: "/settings/go-live", title: "Go-live checklist", sub: "What is ready and what is left", icon: "check" },
        { href: "/help", title: "Help", sub: "Short guide for your role, step by step", icon: "help" },
        { href: "/account", title: "Your account", sub: "Your details, password, appearance, sign out", icon: "user" },
      ],
    },
  ];
  const cats: MenuCategory[] = drafts.map((cat) => ({ ...cat, items: cat.items.filter((i): i is MenuItem => Boolean(i)) }));
  return cats.filter((cat) => cat.items.length > 0);
}

/** The category a role most likely wants first. */
export function defaultCategory(role: Role): string {
  return (
    { sales: "sales", procurement: "purchasing", warehouse: "stock", driver: "stock", finance: "finance", management: "sales" } as Record<Role, string>
  )[role];
}
