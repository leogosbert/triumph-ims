/** LPO financing: labels and the next steps of a request (the database decides; this only shows buttons). */

export const FIN_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "off" },
  submitted: { label: "With the bank", tone: "info" },
  approved: { label: "Approved", tone: "ok" },
  disbursed: { label: "Money received", tone: "warn" },
  repaid: { label: "Repaid", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const FACILITY_LABEL: Record<string, string> = {
  lpo_finance: "LPO (purchase order) financing",
  invoice_discounting: "Invoice discounting",
  overdraft: "Overdraft",
  other: "Other",
};

export type FinStep = { to: string; label: string; needs?: "amount" | "note" | "date" | "invoice"; tone?: "danger" };

/** The buttons a request shows in each status. */
export function nextSteps(status: string): FinStep[] {
  switch (status) {
    case "draft":
      return [{ to: "submitted", label: "Mark submitted to the bank", needs: "date" }, { to: "cancelled", label: "Cancel", tone: "danger" }];
    case "submitted":
      return [
        { to: "approved", label: "Bank approved", needs: "amount" },
        { to: "declined", label: "Bank declined", needs: "note", tone: "danger" },
        { to: "cancelled", label: "Cancel", tone: "danger" },
      ];
    case "approved":
      return [
        { to: "disbursed", label: "Money received", needs: "date" },
        { to: "declined", label: "Bank withdrew", needs: "note", tone: "danger" },
        { to: "cancelled", label: "Cancel", tone: "danger" },
      ];
    case "disbursed":
      return [{ to: "repaid", label: "Loan repaid", needs: "date" }];
    case "declined":
    case "cancelled":
      return [{ to: "draft", label: "Try again (back to draft)" }];
    default:
      return [];
  }
}

/** Simple interest for the tenor, rounded (a guide for the cover letter; the bank's offer decides). */
export function estimatedInterest(amount: number, ratePct: number | null, days: number): number | null {
  if (ratePct == null || !Number.isFinite(ratePct) || ratePct <= 0) return null;
  return Math.round((amount * ratePct * days) / (100 * 365));
}

/** How much of the order the loan covers, in % (null when unknown). */
export function coverPct(amount: number, lpoAmount: number | null): number | null {
  if (!lpoAmount || lpoAmount <= 0) return null;
  return Math.round((amount / lpoAmount) * 100);
}
