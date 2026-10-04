"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Dict } from "@/lib/i18n";
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
  t,
}: {
  companyId: string;
  userId: string;
  deliveries: DriverDelivery[];
  t: Dict;
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
        setMessage(sent === 1 ? t["dr.sentOne"] : `${sent} ${t["dr.sentMany"]}`);
        router.refresh();
      }
    }
  }, [userId, reloadQueue, router, t]);

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
      setMessage(t["dr.storageError"]);
      return false;
    }
    setOpenId(null);
    setMessage(navigator.onLine ? t["dr.savedOnline"] : t["dr.savedOffline"]);
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
          {online ? t["dr.online"] : t["dr.offline"]}
          {pendingCount > 0 && ` · ${pendingCount} ${t["dr.waiting"]}`}
        </span>
        {pendingCount > 0 && (
          <button type="button" className="btn btn-small" onClick={() => sync()} disabled={syncing || !online}>
            {syncing ? t["dr.sending"] : t["dr.sendNow"]}
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
            <strong>{q.number}</strong> {t["dr.couldNotSave"]}: {q.error}
            <div className="actions">
              <button type="button" className="btn btn-small" onClick={() => discard(q.id)}>
                {t["dr.discard"]}
              </button>
            </div>
          </div>
        ))}

      {active.length === 0 && done.length === 0 && (
        <div className="card">
          <p className="muted">{t["dr.none"]}</p>
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
                  {d.planned_date && ` · ${t["dr.planned"]} ${fmtDate(d.planned_date)}`}
                  {d.vehicle && ` · ${d.vehicle}`}
                </div>
              </div>
              {pending && !pending.error ? (
                <span className="badge tone-info">{pending.kind === "fail" ? t["dr.failedWaiting"] : t["dr.deliveredWaiting"]}</span>
              ) : (
                <span className="badge tone-warn">{t["dr.onTheWay"]}</span>
              )}
            </div>
            {d.delivery_site && <p className="drop">📍 {d.delivery_site}</p>}
            {(d.contact_name || d.contact_phone) && (
              <p className="small">
                {t["dr.contact"]}: {d.contact_name}
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
                <PodForm delivery={d} companyId={companyId} userId={userId} onSave={save} onCancel={() => setOpenId(null)} t={t} />
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={() => setOpenId(d.id)}>
                  {t["dr.record"]}
                </button>
              ))}
          </div>
        );
      })}

      {done.length > 0 && (
        <>
          <h2>{t["dr.recent"]}</h2>
          <ul className="rec-list card">
            {done.map((d) => (
              <li key={d.id}>
                <div className="main">
                  <span className="title">{d.client}</span>
                  <span className="sub">
                    {d.number} ·{" "}
                    {d.status === "delivered"
                      ? `${t["dr.receivedBy"]} ${d.received_by_name ?? ""}${d.delivered_at ? `, ${fmtTime(d.delivered_at)}` : ""}`
                      : `${t["dr.failedReason"]}: ${d.failed_reason ?? ""}`}
                  </span>
                </div>
                <span className={`badge ${d.status === "delivered" ? "tone-ok" : "tone-bad"}`}>
                  {d.status === "delivered" ? t["dr.delivered"] : t["dr.failed"]}
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
  t,
}: {
  delivery: DriverDelivery;
  companyId: string;
  userId: string;
  onSave: (item: QueueItem) => Promise<boolean>;
  onCancel: () => void;
  t: Dict;
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
      if (!reason.trim()) return setError(t["dr.errReason"]);
      setBusy(true);
      await onSave({ ...base, kind: "fail", reason: reason.trim() });
      setBusy(false);
      return;
    }
    if (!receivedBy.trim()) return setError(t["dr.errName"]);
    if (!pad.current || pad.current.isEmpty()) return setError(t["dr.errSign"]);
    setBusy(true);
    const signature = await pad.current.toBlob();
    if (!signature) {
      setBusy(false);
      return setError(t["dr.errSignRead"]);
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
          {t["dr.tabDelivered"]}
        </button>
        <button type="button" aria-pressed={mode === "fail"} onClick={() => setMode("fail")}>
          {t["dr.tabFailed"]}
        </button>
      </div>

      {mode === "deliver" ? (
        <>
          <div className="field">
            <label htmlFor={`rb-${delivery.id}`}>{t["dr.receiverName"]}</label>
            <input id={`rb-${delivery.id}`} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label>{t["dr.signature"]}</label>
            <SignaturePad ref={pad} clearLabel={t["dr.clear"]} />
          </div>
          <div className="field">
            <label htmlFor={`ph-${delivery.id}`}>{t["dr.photo"]}</label>
            <input id={`ph-${delivery.id}`} type="file" accept="image/*" capture="environment" onChange={onPhoto} />
            {photoUrl && <img src={photoUrl} alt="Delivery photo" className="pod-photo" />}
          </div>
          <div className="field">
            <label htmlFor={`nt-${delivery.id}`}>{t["dr.remarks"]}</label>
            <textarea id={`nt-${delivery.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t["dr.remarksPh"]} />
          </div>
          <p className="hint">
            {gpsState === "waiting" && t["dr.gpsWaiting"]}
            {gpsState === "ok" && gps && `${t["dr.gpsOk"]} (±${Math.round(gps.acc)} m).`}
            {gpsState === "none" && t["dr.gpsNone"]}
          </p>
        </>
      ) : (
        <div className="field">
          <label htmlFor={`fr-${delivery.id}`}>{t["dr.why"]}</label>
          <textarea id={`fr-${delivery.id}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t["dr.whyPh"]} />
          <p className="hint">{t["dr.backToStock"]}</p>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className={`btn ${mode === "fail" ? "btn-danger" : "btn-primary"}`} onClick={submit} disabled={busy}>
          {busy ? t["dr.saving"] : mode === "fail" ? t["dr.recordFailed"] : t["dr.confirm"]}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t["dr.cancel"]}
        </button>
      </div>
    </div>
  );
}

// ---------- signature pad ----------

type SignaturePadHandle = { isEmpty: () => boolean; toBlob: () => Promise<Blob | null> };

const SignaturePad = forwardRef<SignaturePadHandle, { clearLabel: string }>(function SignaturePad({ clearLabel }, ref) {
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
        {clearLabel}
      </button>
    </div>
  );
});
