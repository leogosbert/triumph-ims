import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ThemePicker } from "@/components/ThemePicker";
import { BackgroundPicker } from "@/components/BackgroundPicker";
import { getAppContext } from "@/lib/context";
import { moreMenu, type MenuItem } from "@/lib/menu";
import { APP_VERSION, BUILD_ID } from "@/lib/releases";

export const metadata = { title: "More" };

function Tile({ item }: { item: MenuItem }) {
  const body = (
    <>
      <span className="tile-ico" aria-hidden>
        <Icon name={item.icon} size={20} />
      </span>
      <span className="tile-body">
        <span className="tile-title">{tr(item.title)}</span>
        <span className="tile-sub">{tr(item.sub)}</span>
      </span>
    </>
  );
  // The driver screen and LeMoSp ADMIN (another address) are plain links.
  return item.plain ? (
    <a href={item.href} className={`tile tile-icon${item.soon ? " tile-soon" : ""}`}>
      {body}
    </a>
  ) : (
    <Link href={item.href} className={`tile tile-icon${item.soon ? " tile-soon" : ""}`}>
      {body}
    </Link>
  );
}

/**
 * Everything in the menu on one page: the same groups and links as the phone menu (src/lib/menu.ts),
 * so each job has one name and one place. Then appearance and the app version.
 */
export default async function MorePage() {
  await primeLang();
  const { role, isManager, features, isPlatformAdmin } = await getAppContext();
  const groups = moreMenu(role, isManager, { on: features.on, isPlatformAdmin, features: features.list, menu: true });

  return (
    <>
      <h1>{tr("More")}</h1>
      <p className="muted small">{tr("Every screen you can open, grouped by the work it is for. Search at the top finds any of them by name.")}</p>

      {groups.map((g) => (
        <section key={g.key} className="more-group" aria-labelledby={`more-${g.key}`}>
          <h2 id={`more-${g.key}`} className="more-group-title">
            <Icon name={g.icon} size={18} />
            {tr(g.label)}
          </h2>
          {g.key === "grow" && <p className="muted small">{tr("Features your business can switch on as it grows. Tap one to learn more.")}</p>}
          <div className="grid grid-2">
            {g.items.map((it) => (
              <Tile key={it.href} item={it} />
            ))}
          </div>
        </section>
      ))}

      <h2 style={{ marginTop: 24 }}>{tr("Appearance")}</h2>
      <p className="muted small">{tr("Auto follows your phone's light or dark setting.")}</p>
      <ThemePicker />
      <h3 className="bg-title">{tr("Background")}</h3>
      <BackgroundPicker />

      <a className="lemo-foot" href="/help">
        <img src="/brand/lemosp.svg" alt={tr("LeMoSp")} />
        <span>{tr("a LeMo Tech Solutions product")}</span>
        <span className="lemo-ver">v{APP_VERSION}{BUILD_ID ? ` · ${BUILD_ID.slice(0, 7)}` : ""}</span>
      </a>
    </>
  );
}
