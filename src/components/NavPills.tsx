"use client";

import { useEffect } from "react";

/**
 * A pill that glides to the current item of the phone bar, the laptop sidebar and the filter tabs
 * on any screen, and snaps to a tapped item at once (before the next screen arrives).
 * It only decorates: links keep aria-current and their own look when JavaScript is off.
 */
const NAVS = ".bottomnav, .sidenav nav, .page .tabs-row:not(.adm-slide)";

function place(nav: HTMLElement, target?: HTMLElement | null) {
  let pill = nav.querySelector<HTMLSpanElement>(":scope > .nav-pill");
  const a = target ?? nav.querySelector<HTMLElement>(':scope > a[aria-current="page"], :scope > a[aria-current="true"]');
  if (!a) {
    nav.classList.remove("has-pill");
    if (pill) pill.style.opacity = "0";
    return;
  }
  if (!pill) {
    pill = document.createElement("span");
    pill.className = "nav-pill";
    pill.setAttribute("aria-hidden", "true");
    nav.prepend(pill);
  }
  pill.style.opacity = "1";
  pill.style.width = `${a.offsetWidth}px`;
  pill.style.height = `${a.offsetHeight}px`;
  pill.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
  if (!nav.classList.contains("has-pill")) {
    nav.classList.add("has-pill");
    // First placement without a glide; later moves glide.
    requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.add("pill-ready")));
  }
}

/**
 * React has taken over this element (it keeps its fiber on the node). Before that, a screen that
 * streams in later is still plain server HTML: adding the pill or a class then makes React's
 * hydration fail and redraw the whole screen, so such a nav is left alone until it is ready.
 */
function hydrated(el: HTMLElement) {
  for (const k in el) if (k.startsWith("__reactFiber$")) return true;
  return false;
}

export function NavPills() {
  useEffect(() => {
    let raf = 0;
    let retry = 0;
    let tries = 0;
    const all = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let waiting = false;
        document.querySelectorAll<HTMLElement>(NAVS).forEach((n) => {
          if (hydrated(n)) place(n);
          else waiting = true;
        });
        // Hydration itself changes nothing the observer sees: look again shortly (for a while).
        window.clearTimeout(retry);
        if (waiting && tries++ < 50) retry = window.setTimeout(all, 100);
        else if (!waiting) tries = 0;
      });
    };
    all();
    // Screens, filters and aria-current change without a full reload: follow them.
    const mo = new MutationObserver((list) => {
      if (list.some((m) => !(m.target instanceof HTMLElement && m.target.classList.contains("nav-pill")))) {
        tries = 0;
        all();
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
    const tap = (e: Event) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      const nav = a?.parentElement;
      if (!a || !nav || !nav.matches(NAVS) || a.getAttribute("aria-haspopup") || !hydrated(nav)) return;
      place(nav, a);
    };
    document.addEventListener("click", tap, true);
    window.addEventListener("resize", all);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(retry);
      mo.disconnect();
      document.removeEventListener("click", tap, true);
      window.removeEventListener("resize", all);
    };
  }, []);
  return null;
}
