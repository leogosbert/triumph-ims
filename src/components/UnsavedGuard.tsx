"use client";

import { useEffect } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * Which forms are watched: every form on a create or edit screen (…/new, …/edit), and any other
 * form marked data-guard (the edit form on a client, supplier or product). data-guard="off" opts out.
 */
export function isGuarded(form: HTMLFormElement, path: string): boolean {
  const mark = form.getAttribute("data-guard");
  if (mark === "off") return false;
  if (mark !== null) return true;
  // (form.method reads "get" for a server-action form too, so look at the attribute itself.)
  if (form.getAttribute("method")?.toLowerCase() === "get" ||form.getAttribute("role") === "search" || !form.closest("main")) return false;
  return /\/(new|edit)(\/|$)/.test(path);
}

export function hasUnsaved(): boolean {
  return document.querySelector("form[data-dirty]") !== null;
}

/**
 * "You have changes that aren't saved" when someone leaves a create or edit form after typing in
 * it: on closing or reloading the tab (beforeunload) and on in-app links. A form stops counting as
 * changed the moment it is sent, so a successful save never warns. Mounted once in the root layout.
 */
export function UnsavedGuard() {
  const tr = useTr();
  useEffect(() => {
    function formOf(t: EventTarget | null): HTMLFormElement | null {
      if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) return null;
      if (!t.name || (t instanceof HTMLInputElement && (t.type === "hidden" || t.type === "search"))) return null;
      const f = t.form;
      return f && isGuarded(f, location.pathname) ? f : null;
    }
    function onEdit(e: Event) {
      if (!e.isTrusted) return; // only what a person typed or picked
      formOf(e.target)?.setAttribute("data-dirty", "");
    }
    function onSubmit(e: Event) {
      (e.target as HTMLFormElement).removeAttribute?.("data-dirty");
    }
    function onReset(e: Event) {
      (e.target as HTMLFormElement).removeAttribute?.("data-dirty");
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return; // other sites: beforeunload asks
      if (to.pathname === location.pathname && to.search === location.search && to.hash) return; // a jump on the same screen
      if (!hasUnsaved()) return;
      if (window.confirm(tr("You have changes that aren't saved. Leave without saving?"))) {
        document.querySelectorAll("form[data-dirty]").forEach((f) => f.removeAttribute("data-dirty"));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    }
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("reset", onReset, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("reset", onReset, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [tr]);
  return null;
}
