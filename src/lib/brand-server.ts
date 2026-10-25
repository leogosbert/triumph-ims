import { cookies } from "next/headers";
import { BRAND_COOKIE, brandByKey, type Brand } from "@/lib/brands";

/** The brand remembered on this device (src/lib/brands.ts), or null for plain LeMoSp. */
export async function getBrand(): Promise<Brand | null> {
  return brandByKey((await cookies()).get(BRAND_COOKIE)?.value);
}
