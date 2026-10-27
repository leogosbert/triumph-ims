import { BackLink } from "@/components/BackLink";
import { Icon, type IconName } from "@/components/Icon";
import { tr } from "@/lib/tr";

/**
 * Same top for every settings screen: the shared back link (BackLink), the title with its icon and
 * one line saying what the page is for.
 */
export function SettingsHead({
  title,
  lead,
  icon,
  back = { href: "/settings", label: tr("← Settings") },
  side,
}: {
  title: string;
  lead?: React.ReactNode;
  icon?: IconName;
  back?: { href: string; label: string } | null;
  side?: React.ReactNode;
}) {
  return (
    <>
      {back && <BackLink href={back.href} label={back.label} />}
      <div className="st-head">
        {icon && (
          <span className="st-head-ico" aria-hidden>
            <Icon name={icon} size={22} />
          </span>
        )}
        <div className="st-head-text">
          <h1>{title}</h1>
          {lead && <p className="st-lead">{lead}</p>}
        </div>
        {side && <div className="st-head-side">{side}</div>}
      </div>
    </>
  );
}

/** Field hint shown under the input (linked with aria-describedby). */
export function Hint({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <span id={id} className="st-hint">
      {children}
    </span>
  );
}
