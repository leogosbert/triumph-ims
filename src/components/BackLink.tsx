import Link from "next/link";
import { Icon } from "@/components/Icon";
import { tr } from "@/lib/tr";

/**
 * The way back to the screen above, the same at the top of every inner screen (a record, a "new"
 * form, an edit form, a sub-page). `label` is the parent's name in English ("Invoices"); anything in
 * `children` (a second link) sits beside it. Server components only (it uses tr()).
 */
export function BackLink({ href, label, children }: { href: string; label: string; children?: React.ReactNode }) {
  // "← Invoices" is the key the Kiswahili list already knows; the arrow itself is drawn as an icon.
  const name = tr(`← ${label.replace(/^←\s*/, "")}`).replace(/^←\s*/, "");
  return (
    <p className="small back-row no-print">
      <Link href={href} className="back-link">
        <Icon name="back" size={15} strokeWidth={2.2} />
        {name}
      </Link>
      {children}
    </p>
  );
}
