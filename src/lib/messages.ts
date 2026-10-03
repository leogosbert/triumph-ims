/** Builds a URL that shows a green (msg) or red (error) note at the top of the page. */
export function withNotice(path: string, notice: { msg?: string; error?: string }) {
  const params = new URLSearchParams();
  if (notice.msg) params.set("msg", notice.msg);
  if (notice.error) params.set("error", notice.error);
  const q = params.toString();
  return q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path;
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
  if (/client_contacts_check/.test(message)) return "Enter at least a name, email or phone for the contact.";
  if (/multiple \(or no\) rows|0 rows/i.test(message)) return "That record wasn't found, or you don't have permission to change it.";
  if (/permission denied|row-level security/i.test(message)) return "You don't have permission to do that.";
  if (/JWT|session/i.test(message)) return "Your session has expired. Please sign in again.";
  return message;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readNotice(searchParams: SearchParams | undefined) {
  const sp = (await searchParams) ?? {};
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { msg: pick(sp.msg), error: pick(sp.error) };
}
