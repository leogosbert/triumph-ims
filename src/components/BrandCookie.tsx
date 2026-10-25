"use client";

import { useEffect } from "react";
import { BRAND_COOKIE } from "@/lib/brands";

/**
 * Remembers the company's brand on this device (see src/lib/brands.ts), so the next page load,
 * the install details and the sign-in page use the company's name and icon. An empty key clears it.
 */
export function BrandCookie({ brand }: { brand: string | null }) {
  useEffect(() => {
    const want = brand ?? "";
    const has = document.cookie.split("; ").find((c) => c.startsWith(`${BRAND_COOKIE}=`))?.slice(BRAND_COOKIE.length + 1) ?? "";
    if (has === want) return;
    document.cookie = want
      ? `${BRAND_COOKIE}=${want}; path=/; max-age=31536000; samesite=lax`
      : `${BRAND_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, [brand]);
  return null;
}
