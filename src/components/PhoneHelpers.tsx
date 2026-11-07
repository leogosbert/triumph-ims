"use client";

import { NewFab } from "@/components/NewFab";
import { PullToRefresh } from "@/components/PullToRefresh";

/** Phone helpers for the company app frame: the round "+" button and pull to refresh. */
export function PhoneHelpers() {
  return (
    <>
      <NewFab />
      <PullToRefresh />
    </>
  );
}
