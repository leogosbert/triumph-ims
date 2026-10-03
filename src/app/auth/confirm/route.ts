import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Only allow redirects to pages inside this app. */
function safeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/**
 * Handles the links in sign-up confirmation and password-reset emails.
 * Supports both link styles Supabase can send (?token_hash=… or ?code=…).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const next = safeNext(params.get("next"));

  const supabase = await createClient();
  let failed = true;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = !!error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = !!error;
  }

  if (failed) {
    redirect(
      `/login?error=${encodeURIComponent(
        "That link has expired or was already used. Please sign in, or request a new link.",
      )}`,
    );
  }
  redirect(next);
}
