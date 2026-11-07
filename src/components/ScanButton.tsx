"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/tr-client";

/**
 * "Scan" with the camera, next to a product search or SKU field. It uses the browser's own
 * BarcodeDetector (Chrome on Android, and others as they add it) and shows nothing where the
 * browser has none, so there is no library to download.
 *
 * `target` is the id of the field to fill:
 * - a text field gets the code (and `submit` sends its form, for a search box);
 * - a product drop-down picks the product whose SKU (data-sku, or "(SKU)" in its text) is the code.
 */
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (opts?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

function detectorClass(): DetectorClass | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return c && typeof navigator.mediaDevices?.getUserMedia === "function" ? c : null;
}

/** Puts the code in the field the way typing would, so React and forms see it. */
function fill(el: HTMLInputElement | HTMLSelectElement, code: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const want = code.trim().toLowerCase();
    const opt = Array.from(el.options).find(
      (o) =>
        o.value &&
        ((o.dataset.sku ?? "").toLowerCase() === want || o.value.toLowerCase() === want || o.text.toLowerCase().endsWith(`(${want})`)),
    );
    if (!opt) return false;
    el.value = opt.value;
  } else {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, code);
    else el.value = code;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function ScanButton({ target, submit = false, className = "btn scan-btn" }: { target: string; submit?: boolean; className?: string }) {
  const tr = useTr();
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const C = detectorClass();
    if (!C) return;
    if (!C.getSupportedFormats) {
      setSupported(true);
      return;
    }
    C.getSupportedFormats()
      .then((f) => setSupported(f.length > 0))
      .catch(() => setSupported(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const C = detectorClass();
    if (!C) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new C();
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);

    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2) {
        try {
          const found = await detector.detect(v);
          const code = found.find((b) => b.rawValue.trim())?.rawValue.trim();
          if (code && !stopped) {
            const el = document.getElementById(target) as HTMLInputElement | HTMLSelectElement | null;
            if (el && fill(el, code)) {
              try {
                navigator.vibrate?.(15);
              } catch {
                /* no haptics */
              }
              setOpen(false);
              if (submit) el.form?.requestSubmit();
              else el.focus();
              return;
            }
            setMsg(`${tr("No product with the code")} ${code}`);
          }
        } catch {
          /* a frame that could not be read: try the next one */
        }
      }
      timer = window.setTimeout(tick, 250);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        tick();
      })
      .catch(() => setMsg(tr("The camera could not be opened. Allow the camera for this app, or type the code.")));

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      document.removeEventListener("keydown", onKey);
      opener.current?.focus();
    };
  }, [open, target, submit, tr]);

  if (!supported) return null;
  return (
    <>
      <button
        ref={opener}
        type="button"
        className={className}
        onClick={() => {
          setMsg("");
          setOpen(true);
        }}
        aria-label={tr("Scan a barcode with the camera")}
        title={tr("Scan a barcode")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 9v6M10 9v6M13 9v6M17 9v6" />
        </svg>
        <span className="scan-btn-text">{tr("Scan")}</span>
      </button>
      {open &&
        createPortal(
        <div className="scan-sheet" role="dialog" aria-modal="true" aria-label={tr("Scan a barcode")} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="scan-box">
            <video ref={video} className="scan-video" muted playsInline aria-hidden="true" />
            <span className="scan-frame" aria-hidden="true" />
            <p className="scan-msg" role="status">{msg || tr("Point the camera at the barcode or QR code.")}</p>
            <button ref={closeBtn} type="button" className="btn btn-block" onClick={() => setOpen(false)}>
              {tr("Cancel")}
            </button>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
