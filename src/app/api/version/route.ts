import { NextResponse } from "next/server";
import { APP_VERSION, BUILD_ID, RELEASES } from "@/lib/releases";

export const dynamic = "force-dynamic";

/** The version that is live right now, with what's new. Open apps compare it with their own build. */
export function GET() {
  const latest = RELEASES[0];
  return NextResponse.json(
    { build: BUILD_ID, version: APP_VERSION, date: latest.date, en: latest.en, sw: latest.sw },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
