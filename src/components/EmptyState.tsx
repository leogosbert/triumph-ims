import Link from "next/link";
import { tr } from "@/lib/tr";
import { Icon, type IconName } from "@/components/Icon";

/**
 * What a list shows when it has no rows: an icon, one plain line and one button for the next step
 * ("No suppliers yet" · "Add your first supplier"). Pass `action` only where the page also shows
 * its New button for this person's roles, so nobody is offered a screen they can't use.
 * `children` is for one small extra link (for example "or import a list").
 */
export function EmptyState({
  icon = "inbox",
  text,
  action,
  children,
}: {
  icon?: IconName;
  text: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="card empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </span>
      <p className="empty-text">{tr(text)}</p>
      {action && (
        <Link href={action.href} className="btn btn-primary">
          {tr(action.label)}
        </Link>
      )}
      {children && <div className="empty-more small">{children}</div>}
    </div>
  );
}
