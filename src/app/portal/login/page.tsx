import { AuthCard } from "../_c/AuthCard";
import { LoginForm } from "../_c/LoginForm";
import { portalReady } from "@/lib/portal/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

// Messages chosen by a short code in the address (never free text from the address).
const ERRORS: Record<string, string> = {
  link: "This sign-in link is used or has expired. Ask for a new code below.",
  limited: "Too many wrong codes. Please wait 15 minutes and try again.",
  none: "This email no longer has portal access. Ask your contact at the company.",
  setup: "The portal is not set up on the server yet.",
};
const INFOS: Record<string, string> = {
  signed_out: "You are signed out.",
};

export default async function PortalLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const email = one("email").slice(0, 200);
  const error = !portalReady() ? ERRORS.setup : one("expired") ? "Your session has ended. Please sign in again." : ERRORS[one("error")];
  return (
    <AuthCard brandKey={one("b")} title="Sign in to the portal">
      <LoginForm initialEmail={/^[^\s<>"]+@[^\s<>"]+$/.test(email) ? email : ""} notice={{ error, info: INFOS[one("msg")] }} disabled={!portalReady()} />
    </AuthCard>
  );
}
