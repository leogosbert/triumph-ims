"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function BottomNav({ showSales, showPurchasing }: { showSales: boolean; showPurchasing: boolean }) {
  const pathname = usePathname();
  const items: Item[] = [
    { href: "/", label: "Home", icon: HOME },
    showSales
      ? { href: "/sales", label: "Sales", icon: SALES }
      : { href: "/clients", label: "Clients", icon: CLIENTS },
    { href: "/products", label: "Products", icon: PRODUCTS },
    ...(showPurchasing ? [{ href: "/purchasing", label: "Purchasing", icon: SUPPLIERS }] : []),
    { href: "/more", label: "More", icon: MORE },
  ];
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((it) => {
        const moreSections = ["/more", "/settings", "/account", "/import", "/activity"];
        const active =
          it.href === "/"
            ? pathname === "/"
            : it.href === "/more"
              ? moreSections.some((p) => pathname.startsWith(p))
              : it.href === "/sales"
                ? ["/sales", "/rfqs", "/quotations", "/clients"].some((p) => pathname.startsWith(p))
                : it.href === "/purchasing"
                  ? ["/purchasing", "/supplier-rfqs", "/purchase-orders", "/suppliers"].some((p) => pathname.startsWith(p))
                  : pathname.startsWith(it.href);
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
