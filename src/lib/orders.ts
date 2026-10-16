import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type StageKey = "quoted" | "approved" | "sent" | "won" | "bought" | "delivered" | "invoiced" | "paid";

/** One stage of an order. owner/owner_id are only filled in for managers. */
export type OrderStage = {
  key: StageKey;
  label: string;
  done: boolean;
  owner: string | null;
  owner_id: string | null;
  assigned: boolean;
};

/** Where an order stands (from order_progress in the database). */
export type OrderJourney = {
  quotation_id: string;
  status: "in_progress" | "completed" | "rejected" | "cancelled" | "superseded";
  stages: OrderStage[];
  done: number;
  total: number;
  percent: number;
  current: OrderStage | null;
  next: OrderStage | null;
  can_assign: boolean;
};

/** Order status words shown next to the bar. */
export const JOURNEY_STATUS: Record<OrderJourney["status"], { label: string; tone: string }> = {
  in_progress: { label: "In progress", tone: "tone-info" },
  completed: { label: "Completed", tone: "tone-ok" },
  rejected: { label: "Lost", tone: "tone-off" },
  cancelled: { label: "Cancelled", tone: "tone-off" },
  superseded: { label: "Replaced by a revision", tone: "tone-off" },
};

/** One order; null before the order-progress SQL has been run. */
export async function loadOrderJourney(supabase: Supabase, quotationId: string): Promise<OrderJourney | null> {
  try {
    const { data, error } = await supabase.rpc("order_progress", { p_quotation: quotationId });
    if (error || !data) return null;
    return data as OrderJourney;
  } catch {
    return null;
  }
}

/** Several orders for a list, keyed by quotation id; empty before the SQL has been run. */
export async function loadOrderJourneys(supabase: Supabase, ids: string[]): Promise<Record<string, OrderJourney>> {
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase.rpc("orders_progress", { p_quotations: ids });
    if (error || !data) return {};
    return data as Record<string, OrderJourney>;
  } catch {
    return {};
  }
}
