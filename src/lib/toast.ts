/**
 * Small pop-up messages ("Saved", "Line removed · Undo"), drawn by <Toaster> in the root layout.
 * Client side only: callers pass screen text that is already wrapped in tr()/useTr().
 */

export type ToastAction = { label: string; onClick: () => void };

export type ToastInput = {
  text: string;
  /** "ok" shows a tick; "info" a turning arrow (used while an undo is possible). */
  tone?: "ok" | "info";
  action?: ToastAction;
  /** Milliseconds before it hides itself; 0 keeps it until dismissToast(). Default 3000. */
  duration?: number;
  /** Draws a shrinking bar over this many milliseconds (the undo window). */
  countdown?: number;
};

export type ToastItem = ToastInput & { id: number };

export const TOAST_EVENT = "lemo:toast";
export const TOAST_DISMISS_EVENT = "lemo:toast-dismiss";

let next = 1;
let listening = false;
// Toasts asked for before <Toaster> is listening (a screen's effects can run before the layout's).
const early: ToastItem[] = [];

/** Shows a toast and returns its id (for dismissToast). Does nothing on the server. */
export function showToast(input: ToastInput): number {
  const id = next++;
  if (typeof window === "undefined") return id;
  const item: ToastItem = { duration: 3000, tone: "ok", ...input, id };
  if (!listening) early.push(item);
  else window.dispatchEvent(new CustomEvent<ToastItem>(TOAST_EVENT, { detail: item }));
  return id;
}

export function dismissToast(id: number) {
  if (typeof window === "undefined") return;
  const at = early.findIndex((i) => i.id === id);
  if (at !== -1) early.splice(at, 1);
  window.dispatchEvent(new CustomEvent<number>(TOAST_DISMISS_EVENT, { detail: id }));
}

/** For <Toaster>: marks it as listening and hands over anything that came in before. */
export function startListening(): ToastItem[] {
  listening = true;
  return early.splice(0);
}

export function stopListening() {
  listening = false;
}
