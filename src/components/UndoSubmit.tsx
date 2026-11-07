"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTr } from "@/lib/tr-client";
import { dismissToast, showToast } from "@/lib/toast";

/** Same mark as SubmitterValue, so its copy and ours replace each other. */
const MARK = "data-submitter-copy";
export const UNDO_MS = 5000;

/**
 * A remove button with 5 seconds to undo, instead of "Are you sure?". Pressing it holds the form
 * back, shows "Line removed · Undo" and dims the row; the form is sent only when the 5 seconds
 * pass without Undo. Only for things that are easy to add back and touch no money (a line on a
 * draft, an attendee, an agenda item); issuing, cancelling and closing keep their own confirmation.
 *
 * The pressed button's name and value still reach the server action (`choice()`, name="action"):
 * the form is sent with requestSubmit(button) and a hidden copy of name/value, like SubmitterValue.
 * Leaving the screen through a link during the 5 seconds sends it straight away.
 */
export function UndoSubmit({
  children,
  done = "Removed",
  className = "btn btn-small btn-danger",
  pendingText = "…",
  name,
  value,
  disabled = false,
  label,
  title,
}: {
  children: React.ReactNode;
  /** What the toast says while undo is possible ("Line removed"). */
  done?: string;
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** aria-label, for icon-only buttons such as ✕. */
  label?: string;
  title?: string;
}) {
  const tr = useTr();
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const [holding, setHolding] = useState(false);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; toast: number; row: Element | null; release: () => void } | null>(null);
  const sending = useRef(false);

  function rowOf(b: HTMLElement) {
    return b.closest("li, tr, .undo-row");
  }

  function clear() {
    const h = hold.current;
    if (!h) return;
    clearTimeout(h.timer);
    dismissToast(h.toast);
    h.row?.removeAttribute("data-undo-pending");
    h.release();
    hold.current = null;
    setHolding(false);
  }

  function send() {
    const b = ref.current;
    clear();
    const form = b?.form;
    if (!b || !form) return;
    form.querySelectorAll(`input[${MARK}]`).forEach((n) => n.remove());
    if (b.name) {
      const copy = document.createElement("input");
      copy.type = "hidden";
      copy.name = b.name;
      copy.value = b.value;
      copy.setAttribute(MARK, "");
      form.appendChild(copy);
    }
    sending.current = true;
    form.requestSubmit(b);
    sending.current = false;
  }

  function undo() {
    const b = ref.current;
    clear();
    b?.focus();
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (sending.current) return; // our own requestSubmit
    e.preventDefault();
    if (hold.current || pending) return;
    const b = e.currentTarget;
    const row = rowOf(b);
    row?.setAttribute("data-undo-pending", "");
    // Leaving the screen within the 5 seconds: a link sends it now; closing or reloading asks first.
    const onLink = (ev: MouseEvent) => {
      const a = (ev.target as Element | null)?.closest?.("a[href]");
      // (Not when the unsaved-changes question was answered "stay": that click was cancelled.)
      if (a && hold.current && !ev.defaultPrevented) send();
    };
    const onUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    document.addEventListener("click", onLink, true);
    window.addEventListener("beforeunload", onUnload);
    const toast = showToast({
      text: tr(done),
      tone: "info",
      duration: 0,
      countdown: UNDO_MS,
      action: { label: tr("Undo"), onClick: undo },
    });
    hold.current = {
      timer: setTimeout(send, UNDO_MS),
      toast,
      row,
      release: () => {
        document.removeEventListener("click", onLink, true);
        window.removeEventListener("beforeunload", onUnload);
      },
    };
    setHolding(true);
    // Pressed from the keyboard (detail 0): put focus on Undo so it can be reached at once.
    if (e.detail === 0) {
      requestAnimationFrame(() => {
        const all = document.querySelectorAll<HTMLElement>(".toaster .toast-action");
        all[all.length - 1]?.focus();
      });
    }
  }

  // The button is gone (its form is no longer on the page, so it can't be sent): tidy up the toast.
  useEffect(
    () => () => {
      if (hold.current) clear();
    },
    [],
  );

  return (
    <button
      ref={ref}
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending || holding}
      aria-disabled={holding || undefined}
      aria-label={label}
      title={title}
      name={name}
      value={value}
      onClick={onClick}
    >
      {pending ? pendingText : children}
    </button>
  );
}
