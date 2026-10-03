"use server";

import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { withNotice } from "@/lib/messages";
import { processOutbox } from "@/lib/outbox";

/** Runs the alert check and sends pending push/email now, and shows what happened. */
export async function runOutboxNow() {
  await requireManager();
  const r = await processOutbox(true);
  const summary = `Alerts created: ${r.alerts}. Sent to the server queue: ${r.claimed}. Phone pushes: ${r.pushed}. Emails: ${r.emailed}.`;
  redirect(
    withNotice("/settings/notifications", r.errors.length ? { error: `${summary} Problems: ${r.errors.slice(0, 3).join("; ")}` } : { msg: summary }),
  );
}
