export const SRFQ_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Collecting prices", tone: "warn" },
  awarded: { label: "Awarded", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const INVITE_STATUS: Record<string, { label: string; tone: string }> = {
  invited: { label: "Waiting for price", tone: "off" },
  quoted: { label: "Price received", tone: "info" },
  declined: { label: "Declined", tone: "bad" },
};

export const PO_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "off" },
  pending_approval: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  sent: { label: "Sent to supplier", tone: "info" },
  confirmed: { label: "Confirmed by supplier", tone: "info" },
  partially_received: { label: "Partly received", tone: "warn" },
  received: { label: "Received", tone: "ok" },
  closed: { label: "Closed", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};
