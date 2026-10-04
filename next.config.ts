import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Each deployment gets its own id so open apps can tell when a newer version is live.
  env: {
    NEXT_PUBLIC_BUILD_ID: (process.env.COMMIT_REF || process.env.GITHUB_SHA || `local-${Date.now()}`).slice(0, 12),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
