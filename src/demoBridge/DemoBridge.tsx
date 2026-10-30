"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { installDemoBridge } from "./bridge";
import { demoConfig, seatFromHost } from "./demoConfig";

/**
 * Demo mode only (the root layout adds it when demoConfig is on): lets the LeMo Demonstrator drive this app in a frame.
 * Outside a frame it does nothing.
 */
export function DemoBridge() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    if (!demoConfig.enabled || window.parent === window) return;
    const supabase = createClient();
    return installDemoBridge({
      win: window,
      parent: window.parent,
      origins: demoConfig.origins,
      seat: seatFromHost(window.location.host),
      app: "lemosp",
      signInPath: "/login",
      currentEmail: async () => (await supabase.auth.getSession()).data.session?.user.email ?? null,
      signOutLocal: async () => {
        await supabase.auth.signOut({ scope: "local" });
      },
      navigate: (path) => routerRef.current.push(path),
    });
  }, []);
  return null;
}
