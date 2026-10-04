"use client";

import { Children, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * Swipe left/right between cards (phones). Dots show where you are and can be tapped.
 * On laptops the cards sit side by side in a grid instead.
 */
export function Carousel({ children, label }: { children: React.ReactNode; label: string }) {
  const tr = useTr();
  const slides = Children.toArray(children).filter(Boolean);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth || 1;
      setActive(Math.min(slides.length - 1, Math.max(0, Math.round(el.scrollLeft / (w * 0.9)))));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [slides.length]);

  function go(i: number) {
    const el = track.current;
    const target = el?.children[i] as HTMLElement | undefined;
    if (el && target) el.scrollTo({ left: target.offsetLeft - el.offsetLeft - 16, behavior: "smooth" });
  }

  if (slides.length === 0) return null;
  return (
    <div className="carousel" aria-roledescription="carousel" aria-label={label}>
      <div className="carousel-track" ref={track}>
        {slides.map((s, i) => (
          <div className="carousel-slide" key={i} aria-roledescription="slide" aria-label={`${i + 1} / ${slides.length}`}>
            {s}
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="carousel-dots" role="tablist">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`${tr("Show card")} ${i + 1}`}
              onClick={() => go(i)}
            />
          ))}
          <span className="carousel-hint">{tr("Swipe for more")}</span>
        </div>
      )}
    </div>
  );
}
