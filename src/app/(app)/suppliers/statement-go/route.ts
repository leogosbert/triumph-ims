import { NextResponse } from "next/server";

/** The "Open statement" picker on /statements: go to the chosen supplier's statement. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const to = /^[0-9a-f-]{36}$/i.test(id) ? `/suppliers/${id}/statement` : "/statements";
  return NextResponse.redirect(new URL(to, url.origin));
}
