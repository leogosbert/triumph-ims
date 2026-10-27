"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { photosFor, photoSrc, sectionFor, type CompanyScenes, type Section } from "@/lib/scenes";

type Layer = { key: number; src: string; focus?: string };

/** A few soft specks drifting upwards; fixed positions so server and phone draw the same. */
const SPECKS = Array.from({ length: 12 }, (_, i) => ({
  left: `${(i * 37 + 7) % 100}%`,
  size: 4 + ((i * 13) % 9),
  dur: 18 + ((i * 7) % 16),
  delay: -((i * 5) % 22),
}));

const ROTATE_MS = 26000;

/**
 * Photos that will not load (the photo host is blocked on this network, or the phone is offline):
 * remembered for the session, so the scene stops asking for more and shows its colour gradient.
 */
const BLOCKED_KEY = "lemo-photos-blocked";
let photosBlocked = false;
function readBlocked(): boolean {
  if (photosBlocked) return true;
  try {
    photosBlocked = sessionStorage.getItem(BLOCKED_KEY) === "1";
  } catch {
    /* storage off: keep the in-memory flag only */
  }
  return photosBlocked;
}
function markBlocked() {
  photosBlocked = true;
  try {
    sessionStorage.setItem(BLOCKED_KEY, "1");
  } catch {
    /* storage off: keep the in-memory flag only */
  }
}
const FADE_MS = 2600;

/**
 * Background → Photos: a photo for the current section, cross-fading when the section changes
 * (and slowly between the section's photos), with a slow Ken Burns zoom under a wash of the
 * section colours, drifting blobs, grain and a few floating specks (styles in src/app/glass.css).
 * Only the photo on screen and the next one are downloaded (phones: only the one on screen). Decorative: hidden from screen readers
 * and when printing; no movement for "reduce motion".
 * `section` fixes the scene (the sign-in page); `onlyGlass` draws nothing unless the Glass style is on.
 */
export function PhotoScene({ section: fixed, scenes, onlyGlass = false }: { section?: Section; scenes?: CompanyScenes | null; onlyGlass?: boolean }) {
  const pathname = usePathname();
  const section = fixed ?? sectionFor(pathname ?? "/");
  const list = photosFor(section, scenes);
  const [on, setOn] = useState(!onlyGlass);
  // Phones: one photo per section and no floating specks; the phone's power goes to scrolling.
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(window.matchMedia("(max-width: 720px)").matches), []);
  const [turn, setTurn] = useState(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => setBlocked(readBlocked()), []);
  const seq = useRef(0);

  useEffect(() => {
    if (onlyGlass) setOn(document.documentElement.getAttribute("data-look") === "glass");
  }, [onlyGlass]);

  // A new section starts at its first photo.
  useEffect(() => setTurn(0), [section]);

  const width = () => (typeof window !== "undefined" && window.innerWidth <= 720 ? 1000 : 1920);
  const photo = list.length ? list[turn % list.length] : null;
  const src = photo ? photoSrc(photo.url, width()) : null;

  // Load the photo first, then fade it in over the old one; drop the old one once hidden.
  useEffect(() => {
    if (!on || !src || !photo || blocked || readBlocked()) return;
    let alive = true;
    const img = new Image();
    const show = () => {
      if (!alive) return;
      setLayers((old) => (old[old.length - 1]?.src === src ? old : [...old.slice(-1), { key: ++seq.current, src, focus: photo.focus }]));
      setTimeout(() => setLayers((old) => old.slice(-1)), FADE_MS + 400);
      // Fetch the next photo of this section in the background so the next change is instant.
      if (list.length > 1 && !phone && !photosBlocked) {
        const next = list[(turn + 1) % list.length];
        new Image().src = photoSrc(next.url, width());
      }
    };
    img.onload = show;
    img.onerror = () => {
      // One failure is enough: no more requests this session, the gradient stands in.
      markBlocked();
      if (alive) setBlocked(true);
    };
    img.src = src;
    if (img.complete && img.naturalWidth) show();
    // (A pending drop is left to run: it only removes photos that have already faded out.)
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, src, blocked]);

  // Slowly move through the section's photos (not for "reduce motion", not while the tab is hidden).
  useEffect(() => {
    if (!on || phone || blocked || list.length < 2) return;
    let still = false;
    try {
      still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      still = false;
    }
    if (still) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setTurn((n) => n + 1);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [on, phone, blocked, list.length, section]);

  if (!on) return null;
  const blend = scenes?.blend;
  return (
    <div
      className={`scene${blend?.wash && blend.wash !== "brand" ? ` wash-${blend.wash}` : ""}`}
      style={
        {
          ...(blend?.strength != null ? { "--photo-strength": String(blend.strength) } : {}),
          ...(blend?.blur != null ? { "--photo-blur": `${blend.blur}px` } : {}),
        } as React.CSSProperties
      }
    >
      {blocked && layers.length === 0 && <div className="scene-fallback" />}
      {layers.map((l, i) => (
        <div
          key={l.key}
          className={`scene-photo${i < layers.length - 1 ? " out" : ""}`}
          style={{ backgroundImage: `url("${l.src}")`, backgroundPosition: l.focus ?? "center" }}
        />
      ))}
      <div className="scene-wash" />
      <span className="scene-blob s1" />
      <span className="scene-blob s2" />
      <span className="scene-blob s3" />
      {!phone && SPECKS.map((s, i) => (
        <span
          key={i}
          className="scene-speck"
          style={{ left: s.left, width: s.size, height: s.size, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
        />
      ))}
      <div className="scene-grain" />
    </div>
  );
}
