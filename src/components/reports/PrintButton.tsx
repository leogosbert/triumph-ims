"use client";

import { useTr } from "@/lib/tr-client";

/** Prints the report on screen (only the report: menus and buttons are left out). */
export function PrintButton() {
  const t = useTr();
  return (
    <button type="button" className="btn btn-small" onClick={() => window.print()}>
      🖨 {t("Print")}
    </button>
  );
}
