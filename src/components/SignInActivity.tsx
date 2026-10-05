import { tr } from "@/lib/tr";
import { formatDateTime } from "@/lib/format";
import { EVENT_LABELS, type SecurityEventRow } from "@/lib/securityLabels";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Your account → "Signed-in devices & activity": the person's last 20 security events and the devices
 * they have signed in from. Hidden until the database update (Security plus) has been run.
 */
export async function SignInActivity({ supabase, userId }: { supabase: Supabase; userId: string }) {
  const [{ data: events, error }, { data: devices }] = await Promise.all([
    supabase
      .from("security_events")
      .select("id, kind, device, ip_hint, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("known_devices").select("device_key, device, first_seen, last_seen").eq("user_id", userId).order("last_seen", { ascending: false }).limit(10),
  ]);
  if (error) return null;
  const rows = (events ?? []) as SecurityEventRow[];
  const known = (devices ?? []) as { device_key: string; device: string | null; first_seen: string; last_seen: string }[];

  return (
    <section className="card" id="activity">
      <h2>{tr("Signed-in devices & activity")}</h2>
      <p className="muted small">{tr("Check that every sign-in was you. If something looks wrong, change your password and sign out on all other devices (above).")}</p>
      {known.length > 0 && (
        <>
          <h3 className="small" style={{ margin: "12px 0 4px" }}>{tr("Devices you have used")}</h3>
          <ul className="sec-events">
            {known.map((d) => (
              <li key={d.device_key}>
                <div className="who">
                  <strong>{d.device ?? tr("Unknown device")}</strong>
                  <span>
                    {tr("First seen")} {formatDateTime(d.first_seen)}
                  </span>
                </div>
                <span className="when">
                  {tr("Last used")}
                  <br />
                  {formatDateTime(d.last_seen)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="small" style={{ margin: "14px 0 4px" }}>{tr("Recent activity")}</h3>
      {rows.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>{tr("Nothing yet. Your next sign-in will appear here.")}</p>
      ) : (
        <ul className="sec-events">
          {rows.map((e) => (
            <li key={e.id}>
              <div className="who">
                <strong>
                  {tr(EVENT_LABELS[e.kind] ?? e.kind)}{" "}
                  {e.kind === "sign_in_new_device" && <span className="badge tone-warn">{tr("New device")}</span>}
                </strong>
                <span>
                  {e.device ?? tr("Unknown device")}
                  {e.ip_hint ? ` · ${e.ip_hint}` : ""}
                </span>
              </div>
              <span className="when">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
