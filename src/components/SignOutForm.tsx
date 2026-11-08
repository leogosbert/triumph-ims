"use client";

import type { ReactNode } from "react";
import { useTr } from "@/lib/tr-client";

/* Signing out always asks first: getting back in takes the password (and the phone code when
 * two-step sign-in is on), so one stray tap in a menu or sheet must never cost that. */
export function SignOutForm({ action, children, style }: { action: (fd: FormData) => void | Promise<void>; children: ReactNode; style?: React.CSSProperties }) {
  const tr = useTr();
  return (
    <form
      action={action}
      style={style}
      onSubmit={(e) => {
        if (!window.confirm(tr("Sign out of LeMoSp on this device? You will need your password to come back."))) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
