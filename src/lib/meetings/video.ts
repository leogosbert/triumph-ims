/**
 * Video rooms for meetings, on the server only. Import it only from server code ("use server" actions, server pages) (DAILY_API_KEY never reaches the browser).
 *
 *   DAILY_API_KEY    optional. Daily.co → Developers → API keys. With it, each meeting gets a private Daily room
 *                    embedded in the app; staff and guests join with a short-lived meeting token.
 *   JITSI_BASE_URL   optional. Without Daily, meetings use a Jitsi room with a long random name, opened in a new tab
 *                    or the Jitsi app (default https://meet.jit.si; set your own Jitsi server or 8x8 JaaS address).
 *
 * Meetings with the client's own link (Zoom, Teams, Google Meet) open that link instead.
 */

export type VideoJoin =
  | { kind: "daily"; url: string; embed: true }
  | { kind: "jitsi"; url: string; embed: false }
  | { kind: "external"; url: string; embed: false }
  | { kind: "none" };

const DAILY = "https://api.daily.co/v1";

export function dailyReady(): boolean {
  return !!process.env.DAILY_API_KEY;
}

export function jitsiUrl(room: string): string {
  const base = (process.env.JITSI_BASE_URL || "https://meet.jit.si").replace(/\/$/, "");
  return `${base}/${encodeURIComponent(room)}`;
}

async function daily(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${DAILY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
}

/** Makes (or finds) the private Daily room for a meeting. Returns its address, or null when Daily is not reachable. */
export async function ensureDailyRoom(room: string, expiresAt: Date): Promise<string | null> {
  if (!dailyReady() || !/^[A-Za-z0-9_-]{16,120}$/.test(room)) return null;
  try {
    const res = await daily("/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: room,
        privacy: "private",
        properties: {
          exp: Math.floor(expiresAt.getTime() / 1000),
          eject_at_room_exp: true,
          enable_chat: true,
          enable_screenshare: true,
          enable_prejoin_ui: true,
          enable_knocking: false,
        },
      }),
    });
    if (res.ok) return ((await res.json()) as { url?: string }).url ?? null;
    // Already made (another device, or earlier): read it.
    const got = await daily(`/rooms/${encodeURIComponent(room)}`, { method: "GET" });
    if (got.ok) return ((await got.json()) as { url?: string }).url ?? null;
    return null;
  } catch {
    return null;
  }
}

/** A meeting token for one person: owners can mute and remove others; it expires with the meeting. */
export async function dailyToken(room: string, opts: { name: string; owner: boolean; userId?: string; expiresAt: Date }): Promise<string | null> {
  if (!dailyReady()) return null;
  try {
    const res = await daily("/meeting-tokens", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          room_name: room,
          user_name: opts.name.slice(0, 60),
          ...(opts.userId ? { user_id: opts.userId.slice(0, 36) } : {}),
          is_owner: opts.owner,
          exp: Math.floor(opts.expiresAt.getTime() / 1000),
          eject_at_token_exp: true,
        },
      }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

/** Adds the meeting token to a Daily room address (the token is a credential: never logged or stored). */
export function withToken(url: string, token: string | null): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/** The Daily domain in a room address, for the embed's allow list (e.g. https://lemosp.daily.co). */
export function dailyOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /\.daily\.co$/.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}
