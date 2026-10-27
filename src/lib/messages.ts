/** Builds a URL that shows a green (msg) or red (error) note at the top of the page. */
export function withNotice(path: string, notice: { msg?: string; error?: string }) {
  const params = new URLSearchParams();
  if (notice.msg) params.set("msg", notice.msg);
  if (notice.error) params.set("error", notice.error);
  const q = params.toString();
  if (!q) return path;
  // The notice goes before any "#section": after it, the browser takes it as part of the hash, so a
  // form that comes back to its own screen never shows the note (and its button stays on "Saving…").
  const hashAt = path.indexOf("#");
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}${q}${hash}`;
}

/** Shown when the browser could not reach the server at all. */
export const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";

/**
 * Did a call fail because the server could not be reached (no connection, server down, blocked),
 * rather than because the server said no? Supabase reports this as AuthRetryableFetchError / status 0.
 */
export function isNetworkError(error: { name?: string; message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError" || error.status === 0) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(error.message ?? "");
}

/** Turns a database error into something a person can act on. */
export function friendlyError(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";
  if (/violates check constraint ".*color/.test(message)) return "Colours must look like #1C4C9B.";
  if (/violates check constraint ".*currency/.test(message)) return "Currencies must be 3-letter codes, like TZS or USD.";
  if (/violates check constraint ".*name/.test(message)) return "The name is too short or too long.";
  if (/duplicate key.*clients_company_id_code_key/.test(message)) return "That client ID is already used by another client.";
  if (/duplicate key.*suppliers_company_id_code_key/.test(message)) return "That supplier ID is already used by another supplier.";
  if (/duplicate key.*products_company_id_sku_key/.test(message)) return "That SKU is already used by another product.";
  if (/products_(shelf_life|warranty)_months_check/.test(message)) return "Shelf life and warranty are in months, from 0 to 600.";
  if (/products_max_level_check/.test(message)) return "The maximum stock level must be above the reorder level.";
  if (/payments_invoice_reference_key/.test(message)) return "This payment reference is already recorded on this invoice.";
  if (/po_lines_received_le_ordered/.test(message)) return "That is more than was ordered on this line.";
  if (/invoices_paid_le_total/.test(message)) return "That is more than is still owed on this invoice.";
  if (/duplicate key.*_company_number_key/.test(message)) return "That number is already used. Please try again.";
  if (/client_contacts_check/.test(message)) return "Enter at least a name, email or phone for the contact.";
  if (/multiple \(or no\) rows|0 rows/i.test(message)) return "That record wasn't found, or you don't have permission to change it.";
  if (/permission denied|row-level security/i.test(message)) return "You don't have permission to do that.";
  if (/JWT|session/i.test(message)) return "Your session has expired. Please sign in again.";
  return plainError(message);
}

/** Text that comes from the database or the API layer, not from one of our own checks. */
const TECHNICAL =
  /schema cache|PGRST\d|violates|syntax|overflow|out of range for type|invalid input|does not exist|null value in column|value too long for type|operator does not exist|could not (find|choose|determine|serialize)|deadlock|canceling statement|statement timeout|duplicate key|relation "|column "|function public\.|\bSQLSTATE\b|unexpected end|Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i;

/**
 * The general cases behind friendlyError. Our own database checks raise plain sentences, and those pass
 * through; anything that looks like developer text is turned into a plain message and never shown raw.
 */
function plainError(message: string): string {
  // Keep the real text in the server log, where it helps; the person sees a plain sentence.
  if (TECHNICAL.test(message) && typeof window === "undefined") console.warn("[friendlyError]", message.slice(0, 500));
  if (/schema cache|function .* does not exist|relation .* does not exist|column .* does not exist|PGRST20[0-9]/i.test(message))
    return "This part needs the latest database update. Ask your LeMo Tech contact to run it.";
  if (/invalid input syntax for type (date|timestamp)|date\/time field value out of range|invalid value for date/i.test(message))
    return "One of the dates is not a real date. Please check it.";
  if (/numeric field overflow|out of range for type|value out of range/i.test(message)) return "That amount or number is too large.";
  if (/invalid input syntax for type (numeric|integer|bigint|double)/i.test(message)) return "One of the numbers is not valid. Please check it.";
  if (/invalid input syntax for type uuid/i.test(message)) return "That record wasn't found.";
  if (/value too long for type/i.test(message)) return "One of the fields is too long. Please shorten it.";
  if (/null value in column/i.test(message)) return "A required field is empty. Please fill it in.";
  if (/duplicate key|violates unique constraint/i.test(message)) return "That is already recorded. Please check for a duplicate.";
  if (/violates foreign key constraint/i.test(message))
    return /delete|update or delete/i.test(message)
      ? "This record is still used elsewhere, so it can't be removed."
      : "Something this refers to no longer exists. Please reload and try again.";
  if (/violates check constraint/i.test(message)) return "One of the values is not allowed. Please check the form and try again.";
  if (/Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message))
    return NETWORK_MESSAGE;
  if (/deadlock|could not serialize|canceling statement|statement timeout/i.test(message)) return "The server was busy. Please try again.";
  if (TECHNICAL.test(message)) return "That didn't work. Please check the values and try again.";
  return message;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readNotice(searchParams: SearchParams | undefined) {
  const sp = (await searchParams) ?? {};
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { msg: pick(sp.msg), error: pick(sp.error) };
}
