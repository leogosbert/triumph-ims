"use client";

import { useEffect } from "react";

/**
 * Privacy screen: when the app goes to the background, the page is blurred so the phone's
 * app switcher (recent apps) does not show figures, names or prices. It clears on return
 * (the app lock may then ask for the password anyway).
 */
export function PrivacyScreen() {
  useEffect(() => {
    const root = document.documentElement;
    const hide = () => root.classList.add("privacy-blur");
    const show = () => root.classList.remove("privacy-blur");
    function onVisibility() {
      if (document.visibilityState === "hidden") hide();
      else show();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      show();
    };
  }, []);
  return null;
}
