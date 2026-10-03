"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type DriverDelivery = {
  id: string;
  number: string;
  status: string;
  planned_date: string | null;
  delivery_site: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  vehicle: string | null;
  notes: string | null;
  delivered_at: string | null;
  received_by_name: string | null;
  failed_reason: string | null;
  client: string;
  lines: { line_no: number; description: string; quantity: number; unit: string }[];
};

/** A proof of delivery (or failed delivery) saved on the phone until it reaches the server. */
type QueueItem = {
  id: string;
  kind: "confirm" | "fail";
  deliveryId: string;
  number: string;
  companyId: string;
  userId: string;
  receivedBy?: string;
  notes?: string;
  reason?: string;
  signature?: Blob;
  photo?: Blob | null;
  lat?: number | null;
  lng?: number | null;
  at: string;
  error?: string;
};

// ---------- IndexedDB queue ----------

const DB_NAME = "ims-pod";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const queueAll = () => withStore<QueueItem[]>("readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>);
const queuePut = (item: QueueItem) => withStore("readwrite", (s) => s.put(item));
const queueDelete = (id: string) => withStore("readwrite", (s) => s.delete(id));

// ---------- helpers ----------

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isNetworkError(message: string) {
  return (
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|aborted/i.test(message)
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso),
  );
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(new Date(iso));
}

/** Shrink a camera photo to at most 1600px so it uploads quickly on a weak signal. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read the photo."));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.8));
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- main component ----------

export function DriverApp({
  companyId,
  userId,
  deliveries,
}: {
  companyId: string;
  userId: string;
  deliveries: DriverDelivery[];
}) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(deliveries.length === 1 && deliveries[0].status === "dispatched" ? deliveries[0].id : null);
  const syncingRef = useRef(false);

  const reloadQueue = useCallback(async () => {
    try {
      setQueue((await queueAll()).filter((q) => q.userId === userId));
    } catch {
      /* IndexedDB unavailable (private mode): the form still works online */
    }
  }, [userId]);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    let sent = 0;
    try {
      const items = (await queueAll()).filter((q) => q.userId === userId && !q.error);
      if (items.length === 0) return;
      const supabase = createClient();
      for (const item of items) {
        try {
          if (item.kind === "confirm") {
            const base = `${item.companyId}/${item.deliveryId}`;
            const sigPath = `${base}/signature-${item.id}.png`;
            const up = await supabase.storage.from("pod").upload(sigPath, item.signature!, { contentType: "image/png" });
            if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(up.error.message);
            let photoPath: string | null = null;
            if (item.photo) {
              photoPath = `${base}/photo-${item.id}.jpg`;
              const pu = await supabase.storage.from("pod").upload(photoPath, item.photo, { contentType: "image/jpeg" });
              if (pu.error && !/exists|duplicate/i.test(pu.error.message)) throw new Error(pu.error.message);
            }
            const { error } = await supabase.rpc("confirm_delivery", {
              p_id: item.deliveryId,
              p_received_by: item.receivedBy ?? "",
              p_signature_path: sigPath,
              p_photo_path: photoPath,
              p_lat: item.lat ?? null,
              p_lng: item.lng ?? null,
              p_notes: item.notes ?? "",
              p_delivered_at: item.at,
            });
            if (error) throw new Error(error.message);
          } else {
            const { error } = await supabase.rpc("fail_delivery", { p_id: item.deliveryId, p_reason: item.reason ?? "" });
            if (error) throw new Error(error.message);
          }
          await queueDelete(item.id);
          sent++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isNetworkError(msg)) break; // still offline: try again later
          await queuePut({ ...item, error: msg }); // the server refused it: show why
        }
      }
    } catch {
      /* ignore: we'll retry on the next trigger */
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await reloadQueue();
      if (sent > 0) {
        setMessage(sent === 1 ? "1 delivery sent to the office." : `${sent} deliveries sent to the office.`);
        router.refresh();
      }
    }
  }, [userId, reloadQueue, router]);

  // Online/offline tracking, background sync, and offline caching of this screen.
  useEffect(() => {
    setOnline(navigator.onLine);
    reloadQueue().then(() => {
      if (navigator.onLine) sync();
    });
    const goOnline = () => {
      setOnline(true);
      sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = window.setInterval(() => {
      if (navigator.onLine) sync();
    }, 60_000);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          const assets = performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .filter((u) => u.startsWith(location.origin) && u.includes("/_next/static/"));
          reg.active?.postMessage({ type: "cache", urls: [location.href, ...assets] });
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(timer);
    };
  }, [reloadQueue, sync]);

  const pendingFor = (id: string) => queue.find((q) => q.deliveryId === id);
  const pendingCount = queue.filter((q) => !q.error).length;

  async function save(item: QueueItem) {
    try {
      await queuePut(item);
    } catch {
      setMessage("This phone could not save the record. Check that private browsing is off and try again.");
      return false;
    }
    setOpenId(null);
    setMessage(navigator.onLine ? "Saved. Sending to the office…" : "Saved on the phone. It will be sent when there is signal.");
    await reloadQueue();
    if (navigator.onLine) sync();
    return true;
  }

  async function discard(id: string) {
    await queueDelete(id);
    await reloadQueue();
  }

  const active = deliveries.filter((d) => d.status === "dispatched");
  const done = deliveries.filter((d) => d.status !== "dispatched");

  return (
    <div className="driver">
      <div className={`sync-bar ${online ? "on" : "off"}`}>
        <span className="dot" aria-hidden="true" />
        <span className="grow">
          {online ? "Online" : "No signal – working offline"}
          {pendingCount > 0 && ` · ${pendingCount} waiting to send`}
        </span>
        {pendingCount > 0 && (
          <button type="button" className="btn btn-small" onClick={() => sync()} disabled={syncing || !online}>
            {syncing ? "Sending…" : "Send now"}
          </button>
        )}
      </div>
      {message && (
        <div className="notice notice-ok" role="status">
          {message}
        </div>
      )}

      {queue
        .filter((q) => q.error)
        .map((q) => (
          <div key={q.id} className="banner bad">
            <strong>{q.number}</strong> could not be saved: {q.error}
            <div className="actions">
              <button type="button" className="btn btn-small" onClick={() => discard(q.id)}>
                Discard
              </button>
            </div>
          </div>
        ))}

      {active.length === 0 && done.length === 0 && (
        <div className="card">
          <p className="muted">No deliveries assigned to you right now. When the store dispatches goods to you, they appear here.</p>
        </div>
      )}

      {active.map((d) => {
        const pending = pendingFor(d.id);
        return (
          <div key={d.id} className="card delivery-card">
            <div className="line-head">
              <div>
                <div className="desc">{d.client}</div>
                <div className="small muted">
                  {d.number}
                  {d.planned_date && ` · planned ${fmtDate(d.planned_date)}`}
                  {d.vehicle && ` · ${d.vehicle}`}
                </div>
              </div>
              {pending && !pending.error ? (
                <span className="badge tone-info">{pending.kind === "fail" ? "Failed – waiting to send" : "Delivered – waiting to send"}</span>
              ) : (
                <span className="badge tone-warn">On the way</span>
              )}
            </div>
            {d.delivery_site && <p className="drop">📍 {d.delivery_site}</p>}
            {(d.contact_name || d.contact_phone) && (
              <p className="small">
                Contact: {d.contact_name}
                {d.contact_phone && (
                  <>
                    {" "}
                    <a href={`tel:${d.contact_phone.replace(/\s+/g, "")}`}>{d.contact_phone}</a>
                  </>
                )}
              </p>
            )}
            {d.notes && <p className="small muted">{d.notes}</p>}
            <ul className="lines">
              {d.lines.map((l) => (
                <li key={l.line_no} className="line-head">
                  <span>{l.description}</span>
                  <strong>
                    {Number(l.quantity).toLocaleString("en-GB", { maximumFractionDigits: 3 })} {l.unit}
                  </strong>
                </li>
              ))}
            </ul>
            {!pending &&
              (openId === d.id ? (
                <PodForm delivery={d} companyId={companyId} userId={userId} onSave={save} onCancel={() => setOpenId(null)} />
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={() => setOpenId(d.id)}>
                  Record delivery
                </button>
              ))}
          </div>
        );
      })}

      {done.length > 0 && (
        <>
          <h2>Recently finished</h2>
          <ul className="rec-list card">
            {done.map((d) => (
              <li key={d.id}>
                <div className="main">
                  <span className="title">{d.client}</span>
                  <span className="sub">
                    {d.number} ·{" "}
                    {d.status === "delivered"
                      ? `received by ${d.received_by_name ?? ""}${d.delivered_at ? `, ${fmtTime(d.delivered_at)}` : ""}`
                      : `failed: ${d.failed_reason ?? ""}`}
                  </span>
                </div>
                <span className={`badge ${d.status === "delivered" ? "tone-ok" : "tone-bad"}`}>
                  {d.status === "delivered" ? "Delivered" : "Failed"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------- proof of delivery form ----------

function PodForm({
  delivery,
  companyId,
  userId,
  onSave,
  onCancel,
}: {
  delivery: DriverDelivery;
  companyId: string;
  userId: string;
  onSave: (item: QueueItem) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"deliver" | "fail">("deliver");
  const [receivedBy, setReceivedBy] = useState(delivery.contact_name ?? "");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [gpsState, setGpsState] = useState<"waiting" | "ok" | "none">("waiting");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGpsState("none");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setGpsState("ok");
      },
      () => setGpsState("none"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const small = await shrinkPhoto(file);
    setPhoto(small);
    setPhotoUrl(URL.createObjectURL(small));
  }

  async function submit() {
    setError(null);
    const at = new Date().toISOString();
    const base = { id: newId(), deliveryId: delivery.id, number: delivery.number, companyId, userId, at };
    if (mode === "fail") {
      if (!reason.trim()) return setError("Say why the delivery failed.");
      setBusy(true);
      await onSave({ ...base, kind: "fail", reason: reason.trim() });
      setBusy(false);
      return;
    }
    if (!receivedBy.trim()) return setError("Enter the name of the person who received the goods.");
    if (!pad.current || pad.current.isEmpty()) return setError("Ask the receiver to sign in the box.");
    setBusy(true);
    const signature = await pad.current.toBlob();
    if (!signature) {
      setBusy(false);
      return setError("Could not read the signature. Clear it and sign again.");
    }
    await onSave({
      ...base,
      kind: "confirm",
      receivedBy: receivedBy.trim(),
      notes: notes.trim(),
      signature,
      photo,
      lat: gps ? Number(gps.lat.toFixed(6)) : null,
      lng: gps ? Number(gps.lng.toFixed(6)) : null,
    });
    setBusy(false);
  }

  return (
    <div className="pod-form">
      <div className="tabs" role="group" aria-label="Outcome">
        <button type="button" aria-pressed={mode === "deliver"} onClick={() => setMode("deliver")}>
          Delivered
        </button>
        <button type="button" aria-pressed={mode === "fail"} onClick={() => setMode("fail")}>
          Could not deliver
        </button>
      </div>

      {mode === "deliver" ? (
        <>
          <div className="field">
            <label htmlFor={`rb-${delivery.id}`}>Received by (name)</label>
            <input id={`rb-${delivery.id}`} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label>Signature</label>
            <SignaturePad ref={pad} />
          </div>
          <div className="field">
            <label htmlFor={`ph-${delivery.id}`}>Photo of the goods (optional)</label>
            <input id={`ph-${delivery.id}`} type="file" accept="image/*" capture="environment" onChange={onPhoto} />
            {photoUrl && <img src={photoUrl} alt="Delivery photo" className="pod-photo" />}
          </div>
          <div className="field">
            <label htmlFor={`nt-${delivery.id}`}>Remarks (optional)</label>
            <textarea id={`nt-${delivery.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 1 drum dented, accepted" />
          </div>
          <p className="hint">
            {gpsState === "waiting" && "Getting your location…"}
            {gpsState === "ok" && gps && `Location captured (±${Math.round(gps.acc)} m).`}
            {gpsState === "none" && "Location not available – the delivery can still be recorded."}
          </p>
        </>
      ) : (
        <div className="field">
          <label htmlFor={`fr-${delivery.id}`}>Why could the goods not be delivered?</label>
          <textarea id={`fr-${delivery.id}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Site closed, receiver not available" />
          <p className="hint">The goods go back into stock when this reaches the office.</p>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className={`btn ${mode === "fail" ? "btn-danger" : "btn-primary"}`} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : mode === "fail" ? "Record failed delivery" : "Confirm delivery"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- signature pad ----------

type SignaturePadHandle = { isEmpty: () => boolean; toBlob: () => Promise<Blob | null> };

const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);

  const setup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * ratio);
    c.height = Math.round(h * ratio);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f44";
    setInked(false);
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => !inked,
    toBlob: () =>
      new Promise<Blob | null>((resolve) => {
        const c = canvasRef.current;
        if (!c) return resolve(null);
        c.toBlob((b) => resolve(b), "image/png");
      }),
  }));

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  return (
    <div className="sig-wrap">
      <canvas
        ref={canvasRef}
        className="sig-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath();
          ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
          ctx.fillStyle = "#0b1f44";
          ctx.fill();
          setInked(true);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = point(e);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <button type="button" className="btn btn-small sig-clear" onClick={setup}>
        Clear
      </button>
    </div>
  );
});
