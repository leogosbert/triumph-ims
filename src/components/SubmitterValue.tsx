"use client";

import { useEffect } from "react";

const MARK = "data-submitter-copy";

/**
 * Makes sure the button that was pressed is sent with its form ("Client accepted" vs "Client
 * rejected", "Approve" vs "Reject", "Move up" …).
 *
 * React adds the pressed button's name and value to a server action's form data through a
 * temporary field tied to `form.id`. Almost every form here has a hidden field called "id", so
 * `form.id` is that field instead of the form's id, the temporary field belongs to no form, and
 * the button's value was silently dropped (an accepted quotation was saved as rejected).
 *
 * So on every press of a submit button that has a name, a hidden copy of its name and value is
 * put inside the form (and the copy from an earlier press is removed). The Enter key in a field
 * also "presses" the form's first button, so it is covered too. Mounted once in the root layout.
 */
export function SubmitterValue() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const b = (e.target as Element | null)?.closest?.("button, input[type=submit]") as HTMLButtonElement | HTMLInputElement | null;
      if (!b || b.type !== "submit" || b.disabled) return;
      const form = b.form;
      if (!form) return;
      form.querySelectorAll(`input[${MARK}]`).forEach((n) => n.remove());
      if (!b.name) return;
      const copy = document.createElement("input");
      copy.type = "hidden";
      copy.name = b.name;
      copy.value = b.value;
      copy.setAttribute(MARK, "");
      form.appendChild(copy);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
