import type { createClient } from "@/lib/supabase/server";
import type { VehicleOpt } from "./AssetFields";

/** Vehicles to link an asset to; empty when fleet is not set up. */
export async function vehicleOptions(supabase: Awaited<ReturnType<typeof createClient>>, company: string): Promise<VehicleOpt[]> {
  const { data, error } = await supabase.from("vehicles").select("id, plate, name").eq("company_id", company).order("plate").limit(500);
  return error ? [] : ((data ?? []) as VehicleOpt[]);
}
