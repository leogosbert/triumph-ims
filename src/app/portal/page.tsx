import { redirect } from "next/navigation";
import { readSession } from "@/lib/portal/server";

export const dynamic = "force-dynamic";

export default async function PortalStart() {
  const { session, account } = await readSession();
  redirect(session ? (account ? "/portal/home" : "/portal/choose") : "/portal/login");
}
