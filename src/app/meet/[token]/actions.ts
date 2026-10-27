"use server";

import { inboxAdmin } from "@/lib/inbox/server";
import { endsAt } from "@/lib/meetings/model";
import { dailyReady, dailyToken, ensureDailyRoom, jitsiUrl, withToken } from "@/lib/meetings/video";

export type GuestView = {
  meeting_id: string;
  attendee_id: string;
  company: string;
  logo_path: string | null;
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
  /** v1.25 SQL: the meeting is set to be recorded, and is being recorded now. */
  record?: boolean;
  recording?: boolean;
};

const TOKEN = /^[0-9a-f]{64}$/;

async function view(token: string): Promise<GuestView | null> {
  const db = inboxAdmin();
  if (!db || !TOKEN.test(token)) return null;
  const { data } = await db.rpc("meeting_guest_view", { p_token: token });
  return (data as GuestView | null) ?? null;
}

/**
 * A guest pressed Join: who joined is recorded, then the call they join: the Daily room with their own guest token
 * (shown inside this page, under the Recording banner), the Jitsi room, or the other side's link. Runs with the
 * service role; the token is checked in the database.
 */
export async function guestJoin(token: string): Promise<{ url: string; embed: boolean } | { error: string }> {
  const v = await view(token);
  if (!v) return { error: "This link does not work." };
  if (!v.can_join) return { error: "You can join from 15 minutes before the start." };
  const { data: ok } = await inboxAdmin()!.rpc("meeting_guest_joined", { p_token: token });
  if (!ok) return { error: "This link does not work." };
  if (v.video_provider === "external" && v.external_link) return { url: v.external_link, embed: false };
  if (dailyReady() && v.video_provider !== "none") {
    const end = Date.parse(endsAt(v));
    // The room is made by the first person who opens it (staff or guest); the same name is used every time.
    const url = v.video_provider === "daily" && v.video_url ? v.video_url : await ensureDailyRoom(v.video_room, new Date(end + 6 * 3600_000));
    if (url) {
      const t = await dailyToken(v.video_room, { name: v.guest_name ?? "Guest", owner: false, expiresAt: new Date(end + 2 * 3600_000) });
      if (t) return { url: withToken(url, t), embed: true };
    }
  }
  return { url: jitsiUrl(v.video_room), embed: false };
}

/** For the guest's Recording banner: is the meeting still on, and is it being recorded now? */
export async function guestStatus(token: string): Promise<{ status: string; recording: boolean } | null> {
  const v = await view(token);
  return v ? { status: v.status, recording: !!v.recording } : null;
}
