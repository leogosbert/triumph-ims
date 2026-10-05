import { headers } from "next/headers";
import { isAdminHost } from "@/lib/hosts";

/** Server only: the address this page was asked for (Netlify passes it in the Host header). */
export async function requestHost(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "";
}

/** Server only: is this request for the LeMoSp ADMIN address? */
export async function onAdminHost(): Promise<boolean> {
  return isAdminHost(await requestHost());
}
