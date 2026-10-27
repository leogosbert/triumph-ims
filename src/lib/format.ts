const TZ = "Africa/Dar_es_Salaam";

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * A two-button choice (Approve / Send back, Client accepted / Client rejected): true for `yes`,
 * false for `no`, and null when neither came through, so a lost button value is refused instead
 * of being saved as the "no" answer.
 */
export function choice(form: FormData, key: string, yes: string, no: string): boolean | null {
  const v = str(form, key);
  return v === yes ? true : v === no ? false : null;
}

export const LOST_CHOICE = "Your choice didn't come through, so nothing was saved. Press the button again.";

/** Empty strings become null so optional fields are stored as "not set". */
export function optional(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

/** Splits a long list (e.g. ids for an `.in()` filter) into pieces short enough for one request URL. */
export function chunk<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
