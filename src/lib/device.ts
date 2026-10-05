/** A short "browser on system" description from the browser's user-agent text (nothing more is kept). */
export function deviceSummary(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s) return "Unknown device";
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /SamsungBrowser\//.test(s)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(s)
          ? "Firefox"
          : /Chrome\/|CriOS\/|Chromium\//.test(s)
            ? "Chrome"
            : /Safari\//.test(s)
              ? "Safari"
              : "Browser";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /CrOS/.test(s)
            ? "Chromebook"
            : /Macintosh|Mac OS X/.test(s)
              ? "Mac"
              : /Linux/.test(s)
                ? "Linux"
                : "unknown system";
  return `${browser} on ${os}`;
}

/** Only the start of the internet address is kept: 41.59.123.4 → "41.59.x.x"; IPv6 → first two groups. */
export function maskIp(ip: string | null | undefined): string | null {
  const v = (ip ?? "").split(",")[0].trim();
  if (!v) return null;
  const v4 = v.replace(/^::ffff:/i, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(v4);
  if (m) return `${m[1]}.${m[2]}.x.x`;
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":")) {
    const parts = v.split(":").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}:x`;
  }
  return null;
}
