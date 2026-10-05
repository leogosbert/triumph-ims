"use client";

import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/Notice";

/** The ?msg= / ?error= note from the address, for screens drawn by a layout (which gets no searchParams). */
export function UrlNotice() {
  const sp = useSearchParams();
  return <Notice msg={sp?.get("msg") ?? undefined} error={sp?.get("error") ?? undefined} />;
}
