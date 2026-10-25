"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Links like /compliance#TRA_TIN (from the AI search) open that requirement in the guide. */
export function HashToGuide() {
  const router = useRouter();
  useEffect(() => {
    const code = window.location.hash.slice(1);
    if (/^[A-Z][A-Z0-9_]{1,59}$/.test(code)) router.replace(`/compliance/guide?code=${encodeURIComponent(code)}`);
  }, [router]);
  return null;
}
