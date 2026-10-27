"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import type { ActionResult } from "../actions";

/**
 * A portal form that calls a server action and shows its answer on the page (never in the address
 * bar, so nobody can send a link that shows made-up text on our portal).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnOk = false,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnOk?: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await action(fd);
          setRes(r);
          if (r.ok) {
            if (resetOnOk) form.reset();
            router.refresh();
          }
        });
      }}
    >
      {res?.error && <p className="notice notice-error" role="alert">{tr(res.error)}</p>}
      {res?.ok && <p className="notice notice-ok" role="status">{tr(res.ok)}</p>}
      <fieldset className="plain" disabled={pending} aria-busy={pending}>
        {children}
      </fieldset>
    </form>
  );
}
