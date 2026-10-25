import { pdfResponse } from "@/lib/pdf/load";
import { clientIp, portalDb, portalRpc, PortalError, readSession } from "@/lib/portal/server";
import { deliveryPdf, invoicePdf, purchaseOrderPdf, quotationPdf, statementPdf } from "@/lib/portal/pdf";

export const dynamic = "force-dynamic";

const KINDS = new Set(["quotation", "invoice", "delivery", "po", "statement"]);

type Opened = { id: string; company_id: string; party: "client" | "supplier"; party_id: string };

/**
 * A quotation, invoice, delivery note, purchase order or statement as a PDF for the signed-in portal
 * account. portal_open() checks the record belongs to this client or supplier and logs the download;
 * only then is the PDF built, from that exact record of that company.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!KINDS.has(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  const { session, account } = await readSession();
  if (!session || !account) return Response.redirect(new URL("/portal/login", req.url), 303);
  const db = portalDb();
  if (!db) return new Response("The portal is not set up yet.", { status: 503 });

  let o: Opened;
  try {
    o = await portalRpc<Opened>("portal_open", { p_session: session, p_account: account, p_kind: kind, p_id: id, p_ip: await clientIp() });
  } catch (e) {
    if (e instanceof PortalError && e.code === "28000") return Response.redirect(new URL("/portal/login?expired=1", req.url), 303);
    return new Response("Not found.", { status: 404 });
  }

  const q = new URL(req.url).searchParams;
  const out =
    kind === "quotation"
      ? await quotationPdf(db, o.company_id, o.id)
      : kind === "invoice"
        ? await invoicePdf(db, o.company_id, o.id)
        : kind === "delivery"
          ? await deliveryPdf(db, o.company_id, o.id)
          : kind === "po"
            ? await purchaseOrderPdf(db, o.company_id, o.id)
            : await statementPdf(db, o.company_id, o.party, o.party_id, { from: q.get("from"), to: q.get("to"), ccy: q.get("ccy") });
  if (!out) return new Response("Not found.", { status: 404 });
  const res = pdfResponse(out.bytes, out.fileName);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
