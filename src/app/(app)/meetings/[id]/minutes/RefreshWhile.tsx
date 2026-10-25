"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the page every few seconds while the minutes are being written in the background. */
export function RefreshWhile({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
