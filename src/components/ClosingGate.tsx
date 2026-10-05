"use client";

import { usePathname } from "next/navigation";

/**
 * While the current company is closing, the app shows only the closing screen, except on the
 * LeMoSp ADMIN pages (/admin inside the company app's address): a platform admin keeps those.
 * The admin pages check the admin themselves and hide the company app's frame.
 */
export function ClosingGate({ closing, children }: { closing: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  if (path === "/admin" || path.startsWith("/admin/")) return <>{children}</>;
  return <>{closing}</>;
}
