"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { MenuCategory } from "@/lib/menu";
import { useTr } from "@/lib/tr-client";

/**
 * The phone menu: slides up over the current screen. Category chips at the top;
 * choosing one fills the list below. Drag down, tap outside, or press Esc to close.
 */
export function MenuSheet({
  open,
  onClose,
  categories,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  categories: MenuCategory[];
  initial: string;
}) {
  const tr = useTr();
  const pathname = usePathname();
  const first = categories.some((c) => c.key === initial) ? initial : (categories[0]?.key ?? "");
  const [cat, setCat] = useState<string>(first);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);

  // Close when a new screen opens.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // While open: Esc closes, the page behind does not scroll, focus moves into the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    // Open on the category of the screen you are on, if there is one.
    const here = categories.find((c) => c.items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)));
    if (here) setCat(here.key);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the chosen chip in view.
  useEffect(() => {
    chips.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [cat, open]);

  const current = categories.find((c) => c.key === cat) ?? categories[0];

  function onDown(e: React.PointerEvent) {
    start.current = e.clientY;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (start.current === null) return;
    setDrag(Math.max(0, e.clientY - start.current));
  }
  function onUp() {
    if (start.current === null) return;
    start.current = null;
    if (drag > 90) onClose();
    setDrag(0);
  }

  return (
    <div className={`msheet${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="msheet-backdrop" onClick={onClose} />
      <div
        ref={panel}
        className={`msheet-panel${drag ? " dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={tr("Menu")}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <div className="msheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="msheet-handle" />
          <div className="msheet-head">
            <strong>{tr("Menu")}</strong>
            <button type="button" className="msheet-x" onClick={onClose} aria-label={tr("Close")}>
              ×
            </button>
          </div>
        </div>

        <div className="msheet-chips" role="tablist" ref={chips}>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={c.key === current?.key}
              onClick={() => setCat(c.key)}
            >
              <Icon name={c.icon} size={17} />
              {tr(c.label)}
              <span className="msheet-count">{c.items.length}</span>
            </button>
          ))}
        </div>

        {current && (
          <ul className="msheet-list" role="tabpanel" key={current.key}>
            {current.items.map((it) => {
              const here = pathname === it.href || pathname.startsWith(`${it.href}/`);
              const body = (
                <>
                  <span className="msheet-ico">
                    <Icon name={it.icon} size={20} />
                  </span>
                  <span className="msheet-txt">
                    <span className="t">{tr(it.title)}</span>
                    <span className="s">{tr(it.sub)}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </>
              );
              return (
                <li key={it.href}>
                  {it.plain ? (
                    <a href={it.href} aria-current={here ? "page" : undefined} onClick={onClose}>
                      {body}
                    </a>
                  ) : (
                    <Link href={it.href} aria-current={here ? "page" : undefined} onClick={onClose}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Link href="/more" className="msheet-all" onClick={onClose}>
          {tr("Open the full More page")}
        </Link>
      </div>
    </div>
  );
}
