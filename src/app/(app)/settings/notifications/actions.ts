"use server";

import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { withNotice } from "@/lib/messages";
import { processOutbox } from "@/lib/outbox";

/** Runs this company's alert check and sends its pending push/email now, and shows what happened. */
export async function runOutboxNow() {
  const { company } = await requireManager();
  const r = await processOutbox(true, company.id);
  const summary = `Alerts created: ${r.alerts}. Sent to the server queue: ${r.claimed}. Phone pushes: ${r.pushed}. Emails: ${r.emailed}.`;
  redirect(
    withNotice("/settings/notifications", r.errors.length ? { error: `${summary} Problems: ${r.errors.slice(0, 3).join("; ")}` } : { msg: summary }),
  );
}
