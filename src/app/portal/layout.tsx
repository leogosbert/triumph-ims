import type { Metadata } from "next";
import "./portal.css";

export const metadata: Metadata = {
  title: { default: "Portal", template: "%s · Portal" },
  robots: { index: false, follow: false },
};

/** Every /portal page (sign-in and signed-in). The signed-in frame is in (in)/layout.tsx. */
export default function PortalRoot({ children }: { children: React.ReactNode }) {
  return <div className="portal-root">{children}</div>;
}
