"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type Role } from "@/lib/roles";

type Item = { href: string; label: string; icon: React.ReactNode };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const HOME = icon("M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z");
const CLIENTS = icon("M3 21V7l9-4 9 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01");
const PRODUCTS = icon("M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8");
const SUPPLIERS = icon("M1 7h13v10H1zM14 10h4l4 4v3h-8zM5.5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z");
const SALES = icon("M4 4h16v16H4zM8 9h8M8 13h8M8 17h5");
const MORE = icon("M4 6h16M4 12h16M4 18h16");

const STOCK = icon("M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4");
const TRUCK = icon("M1 6h13v10H1zM14 9h4l4 4v3h-8zM5.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z");

const SECTIONS: Record<string, string[]> = {
  "/more": ["/more", "/settings", "/account", "/import", "/activity"],
  "/sales": ["/sales", "/rfqs", "/quotations", "/clients"],
  "/purchasing": ["/purchasing", "/supplier-rfqs", "/purchase-orders", "/suppliers"],
  "/stock": ["/stock", "/warehouses", "/receiving", "/grns", "/deliveries"],
  "/deliveries": ["/deliveries"],
  "/driver": ["/driver"],
};

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  let items: Item[];
  if (role === "driver") {
    items = [
      { href: "/driver", label: "Deliveries", icon: TRUCK },
      { href: "/products", label: "Products", icon: PRODUCTS },
      { href: "/more", label: "More", icon: MORE },
    ];
  } else {
    items = [
      { href: "/", label: "Home", icon: HOME },
      can(role, "seeSales")
        ? { href: "/sales", label: "Sales", icon: SALES }
        : role === "warehouse"
          ? { href: "/deliveries", label: "Deliveries", icon: TRUCK }
          : { href: "/clients", label: "Clients", icon: CLIENTS },
      ...(can(role, "seePurchasing") ? [{ href: "/purchasing", label: "Purchasing", icon: SUPPLIERS }] : []),
      ...(can(role, "seeStock") ? [{ href: "/stock", label: "Stock", icon: STOCK }] : []),
    ];
    if (items.length < 4) items.push({ href: "/products", label: "Products", icon: PRODUCTS });
    items.push({ href: "/more", label: "More", icon: MORE });
  }
  const hasDeliveriesTab = items.some((i) => i.href === "/deliveries");
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((it) => {
        let paths = SECTIONS[it.href] ?? [it.href];
        if (it.href === "/stock" && hasDeliveriesTab) paths = paths.filter((p) => p !== "/deliveries");
        const active = it.href === "/" ? pathname === "/" : paths.some((p) => pathname.startsWith(p));
        // The driver screen is a plain link so the phone can open it offline.
        if (it.href === "/driver") {
          return (
            <a key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
              {it.icon}
              {it.label}
            </a>
          );
        }
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            {it.icon}
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
