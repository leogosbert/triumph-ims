import type { InvoiceRow } from "./types";

/**
 * PAY LINK HOOK (client portal → Invoices).
 *
 * The client portal shows a "Pay now" button on every unpaid invoice when this returns an address.
 * Payment links are built separately; until then this returns null and the portal shows how to pay
 * by bank transfer or mobile money instead (the company's payment details on the invoice PDF).
 *
 * To connect payment links, replace the body with a lookup, for example:
 *   const { data } = await db.rpc("payment_link_for_invoice", { p_invoice: inv.id });
 *   return typeof data === "string" ? data : null;
 * It runs on the server for the signed-in portal account, after the invoice was checked to belong
 * to that client (it comes from portal_invoices). Return an https address or null.
 */
export async function payLinkFor(inv: Pick<InvoiceRow, "id" | "number" | "balance" | "currency" | "status">, companyId: string): Promise<string | null> {
  void inv;
  void companyId;
  return null;
}
