"use client";

import { useEffect } from "react";
import { useTr } from "@/lib/tr-client";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const HINT = "data-field-hint";
const SKIP = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "search"]);

function isField(el: EventTarget | null): el is Field {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return false;
  if (el instanceof HTMLInputElement && SKIP.has(el.type)) return false;
  return el.willValidate && !el.closest("[data-no-checks]");
}

/** The English message for what is wrong with a field, from the browser's own checks. */
export function fieldMessage(el: Field, tr: (s: string) => string): string {
  const v = el.validity;
  if (v.valid) return "";
  if (v.valueMissing) return el instanceof HTMLSelectElement ? tr("Choose one.") : tr("This is required.");
  if (v.typeMismatch) {
    if (el.type === "email") return tr("Enter an email address, like name@company.co.tz.");
    if (el.type === "url") return tr("Enter a web address starting with https://");
    return tr("This doesn't look right.");
  }
  if (v.badInput) return tr("Enter a number.");
  if (v.patternMismatch) return el.getAttribute("title") || tr("This doesn't look right. Please check the format.");
  if (v.tooShort) return `${tr("Use at least")} ${(el as HTMLInputElement).minLength} ${tr("characters.")}`;
  if (v.tooLong) return `${tr("Use at most")} ${(el as HTMLInputElement).maxLength} ${tr("characters.")}`;
  if (v.rangeUnderflow) return `${tr("Use")} ${(el as HTMLInputElement).min} ${tr("or more.")}`;
  if (v.rangeOverflow) return `${tr("Use")} ${(el as HTMLInputElement).max} ${tr("or less.")}`;
  if (v.stepMismatch) return (el as HTMLInputElement).step === "1" ? tr("Use a whole number.") : tr("That value isn't allowed here.");
  return el.validationMessage || tr("This doesn't look right.");
}

/**
 * Live checks on every form: when a field is left (blur) or a Save is refused, a short hint
 * appears under it, from the checks already on the field (required, pattern, min, maxLength,
 * type="email"). The hint updates while typing and goes away once the field is right. Mounted
 * once in the root layout; a form or field can opt out with data-no-checks.
 */
export function FieldChecks() {
  const tr = useTr();
  useEffect(() => {
    function hintFor(el: Field): HTMLElement | null {
      const id = el.getAttribute("aria-describedby")?.split(/\s+/).find((x) => x.startsWith("fchint-"));
      return id ? document.getElementById(id) : null;
    }

    function show(el: Field) {
      const message = fieldMessage(el, tr);
      let hint = hintFor(el);
      if (!message) {
        el.removeAttribute("aria-invalid");
        hint?.remove();
        if (hint) {
          const rest = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== hint!.id);
          if (rest.length) el.setAttribute("aria-describedby", rest.join(" "));
          else el.removeAttribute("aria-describedby");
        }
        return;
      }
      el.setAttribute("aria-invalid", "true");
      if (!hint) {
        hint = document.createElement("span");
        hint.id = `fchint-${Math.random().toString(36).slice(2, 9)}`;
        hint.className = "field-hint";
        hint.setAttribute(HINT, "");
        // After the field, or after its wrapper (a password eye, a "TZS" unit) when there is one.
        const wrap = el.parentElement?.matches(".password-wrap, .input-unit, .with-unit") ? el.parentElement : el;
        wrap.insertAdjacentElement("afterend", hint);
        el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
      }
      if (hint.textContent !== message) hint.textContent = message;
    }

    function onBlur(e: FocusEvent) {
      const el = e.target;
      if (!isField(el)) return;
      // Leaving an empty field you never typed in is not an error yet; Save will say so.
      if (!el.dataset.touched && el.value === "" && el.validity.valueMissing) return;
      el.dataset.touched = "1";
      show(el);
    }
    function onInput(e: Event) {
      const el = e.target;
      if (!isField(el)) return;
      if (el.dataset.touched) show(el);
    }
    // Save pressed with something wrong: the browser checks each field; show every hint under its
    // field instead of the browser's own bubble, and put the cursor in the first one.
    let focusing = false;
    function onInvalid(e: Event) {
      const el = e.target;
      if (!isField(el)) return;
      e.preventDefault();
      el.dataset.touched = "1";
      show(el);
      if (!focusing) {
        focusing = true;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        setTimeout(() => (focusing = false));
      }
    }
    function onReset(e: Event) {
      const form = e.target as HTMLFormElement;
      // React clears a form after a successful action: take the hints and marks with it.
      setTimeout(() => {
        form.querySelectorAll(`[${HINT}]`).forEach((n) => n.remove());
        form.querySelectorAll<Field>("[data-touched]").forEach((el) => {
          delete el.dataset.touched;
          el.removeAttribute("aria-invalid");
          const rest = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && !x.startsWith("fchint-"));
          if (rest.length) el.setAttribute("aria-describedby", rest.join(" "));
          else el.removeAttribute("aria-describedby");
        });
      });
    }
    document.addEventListener("focusout", onBlur, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("reset", onReset, true);
    return () => {
      document.removeEventListener("focusout", onBlur, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("reset", onReset, true);
    };
  }, [tr]);
  return null;
}
