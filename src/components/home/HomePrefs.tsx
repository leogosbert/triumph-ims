"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Kpi } from "@/lib/dashboard";
import { useTr } from "@/lib/tr-client";
import { EMPTY_LAYOUT, mergeOrder, move, parseLayout, type HomeLayout } from "@/lib/homeLayout";
import { CountUp } from "@/components/CountUp";
import { KpiTile } from "@/components/home/KpiTile";
import { Icon } from "@/components/Icon";

/** A home section the person can move or hide. `locked` ones (tips, set-up) can be moved, not hidden. */
export type HomeSectionMeta = { id: string; label: string; locked?: boolean };
/** A section as rendered: `overlap` ones may sit on the banner's lower edge (cards, not plain headings). */
export type HomeSectionNode = { id: string; overlap?: boolean; node: React.ReactNode };

type Ctx = {
  tiles: Kpi[];
  hiddenTiles: Set<string>;
  sections: HomeSectionMeta[];
  hiddenSections: Set<string>;
  ready: boolean;
  update: (fn: (l: HomeLayout) => HomeLayout) => void;
  reset: () => void;
};

const HomeCtx = createContext<Ctx | null>(null);

function useHome(): Ctx {
  const c = useContext(HomeCtx);
  if (!c) throw new Error("Home components must sit inside HomePrefsProvider");
  return c;
}

/**
 * Holds the person's layout for this device. The first render is always the default layout (what the
 * server drew); the saved one is applied straight after, so the screen works without storage.
 */
export function HomePrefsProvider({
  storageKey,
  kpis,
  sections,
  countUp,
  children,
}: {
  storageKey: string;
  kpis: Kpi[];
  sections: HomeSectionMeta[];
  /** CountUp selector, started once the saved layout is in place. */
  countUp?: string;
  children: React.ReactNode;
}) {
  const [layout, setLayout] = useState<HomeLayout>(EMPTY_LAYOUT);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      /* storage blocked: keep the default layout */
    }
    setLayout(parseLayout(raw));
    setReady(true);
  }, [storageKey]);

  const tileIds = kpis.map((k) => k.key);
  const sectionIds = sections.map((s) => s.id);
  const tileOrder = mergeOrder(layout.tiles, tileIds);
  const sectionOrder = mergeOrder(layout.sections, sectionIds);
  const locked = new Set(sections.filter((s) => s.locked).map((s) => s.id));

  const save = useCallback(
    (l: HomeLayout) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(l));
      } catch {
        /* not saved on this device; the change still applies until the screen is left */
      }
    },
    [storageKey],
  );
  const update = (fn: (l: HomeLayout) => HomeLayout) => {
    setLayout((prev) => {
      const next = fn({ ...prev, tiles: mergeOrder(prev.tiles, tileIds), sections: mergeOrder(prev.sections, sectionIds) });
      save(next);
      return next;
    });
  };
  const reset = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* nothing saved */
    }
    setLayout(EMPTY_LAYOUT);
  };

  const value: Ctx = {
    tiles: tileOrder.map((id) => kpis.find((k) => k.key === id)!).filter(Boolean),
    hiddenTiles: new Set(layout.hiddenTiles),
    sections: sectionOrder.map((id) => sections.find((s) => s.id === id)!).filter(Boolean),
    hiddenSections: new Set(layout.hiddenSections.filter((id) => !locked.has(id))),
    ready,
    update,
    reset,
  };
  return (
    <HomeCtx.Provider value={value}>
      {children}
      {ready && countUp && <CountUp selector={countUp} />}
    </HomeCtx.Provider>
  );
}

function visibleTiles(c: Ctx) {
  return c.tiles.filter((k) => !c.hiddenTiles.has(k.key));
}

/** The first two shown figures, on the banner. */
export function HomeHeroTiles({ currency }: { currency: string }) {
  const tr = useTr();
  const c = useHome();
  const shown = visibleTiles(c).slice(0, 2);
  if (!shown.length) return null;
  return (
    <div className="hero-kpis">
      {shown.map((k) => (
        <KpiTile key={k.key} k={k} currency={currency} variant="hero" tr={tr} />
      ))}
    </div>
  );
}

/** The other shown figures, in the Key figures card. */
export function HomeKeyFigures({ currency }: { currency: string }) {
  const tr = useTr();
  const c = useHome();
  const rest = visibleTiles(c).slice(2);
  return (
    <section className="card stat-slide">
      <h2>{tr("Key figures")}</h2>
      {rest.length ? (
        <div className="stat-grid">
          {rest.map((k) => (
            <KpiTile key={k.key} k={k} currency={currency} variant="stat" tr={tr} />
          ))}
        </div>
      ) : (
        <p className="small muted">{tr("No more figures to show. Use Customise at the top of home to choose them.")}</p>
      )}
    </section>
  );
}

/**
 * The home sections in the person's order. Leading card sections (and any error notice) sit on the
 * banner's lower edge, as before; when none does, the banner closes up instead (.home-flat).
 */
export function HomeFlow({ notice, hasNotice, sections }: { notice: React.ReactNode; hasNotice: boolean; sections: HomeSectionNode[] }) {
  const c = useHome();
  const byId = new Map(sections.map((s) => [s.id, s]));
  const shown = c.sections.filter((s) => !c.hiddenSections.has(s.id) && byId.has(s.id)).map((s) => byId.get(s.id)!);
  let lead = 0;
  while (lead < shown.length && shown[lead].overlap) lead++;
  const top = shown.slice(0, lead);
  const rest = shown.slice(lead);
  const block = (s: HomeSectionNode) => (
    <div key={s.id} className="home-sec" data-home-section={s.id}>
      {s.node}
    </div>
  );
  return (
    <>
      {hasNotice || top.length ? (
        <div className="hero-overlap">
          {notice}
          {top.map(block)}
        </div>
      ) : (
        <div className="home-flat">{notice}</div>
      )}
      {rest.map(block)}
    </>
  );
}

/** "Customise": a list of figures and sections, each with show/hide and up/down. */
export function HomeCustomise() {
  const tr = useTr();
  const c = useHome();
  const dialog = useRef<HTMLDialogElement>(null);
  const [said, setSaid] = useState("");

  const open = () => {
    const d = dialog.current;
    if (!d) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  };
  const close = () => {
    const d = dialog.current;
    if (!d) return;
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  };

  const shownTiles = visibleTiles(c).map((k) => k.key);
  const rows = {
    tiles: c.tiles.map((k) => ({ id: k.key, label: k.label, locked: false })),
    sections: c.sections.map((s) => ({ id: s.id, label: s.label, locked: !!s.locked })),
  };

  const moveTile = (id: string, label: string, dir: -1 | 1) => {
    c.update((l) => ({ ...l, tiles: move(l.tiles, id, dir) }));
    setSaid(`${tr(label)}: ${dir < 0 ? tr("moved up") : tr("moved down")}`);
  };
  const moveSection = (id: string, label: string, dir: -1 | 1) => {
    c.update((l) => ({ ...l, sections: move(l.sections, id, dir) }));
    setSaid(`${tr(label)}: ${dir < 0 ? tr("moved up") : tr("moved down")}`);
  };
  const toggle = (kind: "tiles" | "sections", id: string, label: string, show: boolean) => {
    const key = kind === "tiles" ? "hiddenTiles" : "hiddenSections";
    c.update((l) => ({ ...l, [key]: show ? l[key].filter((x) => x !== id) : [...l[key].filter((x) => x !== id), id] }));
    setSaid(`${tr(label)}: ${show ? tr("shown") : tr("hidden")}`);
  };

  const list = (kind: "tiles" | "sections", items: { id: string; label: string; locked: boolean }[]) => (
    <ol className="hc-list">
      {items.map((it, i) => {
        const hidden = kind === "tiles" ? c.hiddenTiles.has(it.id) : c.hiddenSections.has(it.id);
        const onBanner = kind === "tiles" && !hidden && shownTiles.indexOf(it.id) > -1 && shownTiles.indexOf(it.id) < 2;
        const doMove = kind === "tiles" ? moveTile : moveSection;
        return (
          <li key={it.id} className={hidden ? "is-hidden" : undefined}>
            <span className="hc-name">
              {tr(it.label)}
              {onBanner && <span className="hc-note">{tr("On the banner")}</span>}
              {it.locked && <span className="hc-note">{tr("Always shown when there is something to show")}</span>}
            </span>
            <span className="hc-tools">
              <button type="button" className="hc-btn" onClick={() => doMove(it.id, it.label, -1)} disabled={i === 0} aria-label={`${tr("Move up")}: ${tr(it.label)}`}>
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                className="hc-btn"
                onClick={() => doMove(it.id, it.label, 1)}
                disabled={i === items.length - 1}
                aria-label={`${tr("Move down")}: ${tr(it.label)}`}
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button
                type="button"
                role="switch"
                className="hc-switch"
                aria-checked={!hidden}
                aria-label={`${tr("Show")}: ${tr(it.label)}`}
                disabled={it.locked}
                onClick={() => toggle(kind, it.id, it.label, hidden)}
              >
                <span aria-hidden="true" />
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      <button type="button" className="hero-customise" onClick={open} aria-haspopup="dialog">
        <Icon name="settings" size={16} strokeWidth={2} />
        <span>{tr("Customise")}</span>
      </button>
      <dialog ref={dialog} className="hc-dialog" aria-labelledby="hc-title" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="hc-body">
          <div className="hc-head">
            <h2 id="hc-title">{tr("Customise your home")}</h2>
            <button type="button" className="hc-btn hc-close" onClick={close} aria-label={tr("Close")}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <p className="small muted">{tr("Choose what shows on your home screen and in what order. This is saved on this device only.")}</p>
          {rows.tiles.length > 0 && (
            <>
              <h3>{tr("Figures")}</h3>
              <p className="small muted">{tr("The first two shown sit on the banner; the rest are under Key figures.")}</p>
              {list("tiles", rows.tiles)}
            </>
          )}
          <h3>{tr("Sections")}</h3>
          {list("sections", rows.sections)}
          <p className="sr-only" aria-live="polite">
            {said}
          </p>
          <div className="hc-foot">
            <button type="button" className="btn" onClick={() => (c.reset(), setSaid(tr("Default layout restored")))}>
              {tr("Reset to default")}
            </button>
            <button type="button" className="btn btn-primary" onClick={close}>
              {tr("Done")}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
