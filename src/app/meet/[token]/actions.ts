"use server";

import { redirect } from "next/navigation";
import { inboxAdmin } from "@/lib/inbox/server";
import { endsAt } from "@/lib/meetings/model";
import { dailyReady, dailyToken, ensureDailyRoom, jitsiUrl, withToken } from "@/lib/meetings/video";

type View = {
  meeting_id: string;
  attendee_id: string;
  title: string;
  starts_at: string;
  minutes: number;
  status: string;
  video_provider: string;
  video_room: string;
  video_url: string | null;
  external_link: string | null;
  guest_name: string | null;
  can_join: boolean;
};

/**
 * A guest pressed Join: who joined is recorded, then they go to the call (the Daily room with their own
 * guest token, the Jitsi room, or the other side's link). Runs with the service role; the token is checked
 * in the database.
 */
export async function guestJoin(form: FormData) {
  const token = String(form.get("token") ?? "");
  const back = (error: string): never => redirect(`/meet/${/^[0-9a-f]{64}$/.test(token) ? token : ""}?error=${encodeURIComponent(error)}`);
  const db = inboxAdmin();
  if (!db || !/^[0-9a-f]{64}$/.test(token)) back("This link does not work.");
  const { data } = await db!.rpc("meeting_guest_view", { p_token: token });
  const v = data as View | null;
  if (!v) back("This link does not work.");
  if (!v!.can_join) back("You can join from 15 minutes before the start.");
  const { data: ok } = await db!.rpc("meeting_guest_joined", { p_token: token });
  if (!ok) back("This link does not work.");

  if (v!.video_provider === "external" && v!.external_link) redirect(v!.external_link);
  if (dailyReady() && v!.video_provider !== "none") {
    const end = Date.parse(endsAt(v!));
    // The room is made by the first person who opens it (staff or guest); the same name is used every time.
    const url = v!.video_provider === "daily" && v!.video_url ? v!.video_url : await ensureDailyRoom(v!.video_room, new Date(end + 6 * 3600_000));
    if (url) {
      const t = await dailyToken(v!.video_room, { name: v!.guest_name ?? "Guest", owner: false, expiresAt: new Date(end + 2 * 3600_000) });
      if (t) redirect(withToken(url, t));
    }
  }
  redirect(jitsiUrl(v!.video_room));
}
