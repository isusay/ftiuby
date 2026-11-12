import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Upload ZIP (Drop) dikirim lewat server action; batas file 25 MB + ruang untuk field form.
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  images: { remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
