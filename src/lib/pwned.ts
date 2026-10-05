/**
 * How often a password appears in known data breaches (haveibeenpwned.com "Pwned Passwords").
 * k-anonymity: only the first 5 characters of the password's SHA-1 hash are sent, never the password.
 * Works in the browser and on the server. Returns 0 when the service cannot be reached (never blocks offline).
 */
export async function timesLeaked(pw: string, timeoutMs = 4000): Promise<number> {
  try {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, {
        headers: { "Add-Padding": "true" },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) return 0;
      const tail = hex.slice(5);
      for (const line of (await res.text()).split("\n")) {
        const [h, n] = line.trim().split(":");
        if (h === tail) return Number(n) || 0;
      }
      return 0;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return 0;
  }
}

export const LEAKED_MESSAGE = "This password has appeared in data breaches. Please choose a different one.";
