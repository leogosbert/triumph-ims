"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * A quick action on a list row. Only links to things the record already offers (its page, a
 * section of it, a phone number): rows never get new server logic of their own.
 */
/** `newTab` opens a file (a PDF) in a new tab instead of moving within the app. */
export type RowAction = { label: string; href: string; tone?: "go" | "call" | "pay"; newTab?: boolean };

/** Below this width rows are cards and the actions hide behind them until a swipe. */
const PHONE = "(max-width: 700px)";
/** How far (px) a finger moves before we decide between a swipe and a scroll. */
const SLOP = 8;

/**
 * A `.rec-list` row with quick actions. Phone: swipe the row left to reveal them, swipe right or
 * tap elsewhere to close. Laptop: the actions sit at the end of the row. Keyboard: tabbing onto an
 * action opens the row, so they are always reachable without a swipe.
 * `href` is the row's own page: it becomes an "Open" action on the phone (the row itself opens it on
 * a laptop). A row with no other action stays a plain row.
 */
export function SwipeRow({
  href,
  actions: extra,
  children,
  className,
}: {
  href?: string;
  actions: RowAction[];
  children: React.ReactNode;
  className?: string;
}) {
  const t = useTr();
  const li = useRef<HTMLLIElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const acts = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; base: number; w: number; mode: "?" | "x" | "y"; dx: number } | null>(null);
  const moved = useRef(false);

  // Tapping anywhere else closes an open row.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (li.current && !li.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // A mouse drag should slide the row, not pick up the link inside it (which cancels the pointer).
  useEffect(() => {
    track.current?.querySelectorAll("a, img").forEach((el) => el.setAttribute("draggable", "false"));
  }, []);

  // The open offset is the actions' own width, measured when they show.
  useEffect(() => {
    if (open && li.current && acts.current) li.current.style.setProperty("--sw-w", `${acts.current.offsetWidth}px`);
  }, [open]);

  if (extra.length === 0) return <li className={className}>{children}</li>;
  const actions: (RowAction & { phone?: boolean })[] = href ? [{ label: "Open", href, phone: true }, ...extra] : extra;

  const phone = () => {
    try {
      return window.matchMedia(PHONE).matches;
    } catch {
      return false;
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0) || !phone()) return;
    const w = acts.current?.offsetWidth ?? 0;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: open ? -w : 0, w, mode: "?", dx: 0 };
    moved.current = false;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === "?") {
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null; // a scroll: leave it to the browser
        return;
      }
      if (Math.abs(dx) <= SLOP) return;
      d.mode = "x";
      moved.current = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      li.current?.classList.add("sw-drag");
    }
    d.dx = Math.max(-d.w - 24, Math.min(0, d.base + dx));
    if (track.current) track.current.style.transform = `translateX(${d.dx}px)`;
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.mode !== "x") return;
    li.current?.classList.remove("sw-drag");
    if (track.current) track.current.style.transform = "";
    // Open past 40% of the actions' width, otherwise snap back.
    setOpen(d.dx < -d.w * 0.4);
  };

  const onCancel = () => {
    drag.current = null;
    li.current?.classList.remove("sw-drag");
    if (track.current) track.current.style.transform = "";
  };

  // A swipe is not a tap: keep the row's link from opening after one, and let a tap on an open row close it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current || (open && phone())) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = false;
      if (open) setOpen(false);
    }
  };

  return (
    <li
      ref={li}
      className={`sw${open ? " sw-open" : ""}${className ? ` ${className}` : ""}`}
      onFocus={(e) => {
        if (acts.current?.contains(e.target as Node)) setOpen(true);
      }}
      onBlur={(e) => {
        if (!li.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) setOpen(false);
      }}
    >
      <div
        ref={track}
        className="sw-track"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      <div ref={acts} className="sw-acts" role="group" aria-label={t("Quick actions")}>
        {actions.map((a) =>
          a.href.startsWith("/") && !a.newTab ? (
            <Link key={a.href} href={a.href} className={`sw-act sw-${a.tone ?? "go"}${a.phone ? " sw-phone" : ""}`}>
              {t(a.label)}
            </Link>
          ) : (
            <a
              key={a.href}
              href={a.href}
              className={`sw-act sw-${a.tone ?? "go"}${a.phone ? " sw-phone" : ""}`}
              {...(a.newTab ? { target: "_blank", rel: "noopener" } : {})}
            >
              {t(a.label)}
            </a>
          ),
        )}
      </div>
      {open && (
        <span className="sr-only" aria-live="polite">
          {t("Quick actions shown")}
        </span>
      )}
    </li>
  );
}
