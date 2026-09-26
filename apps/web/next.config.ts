import type { NextConfig } from "next";

const api = process.env.NIGHTPLOT_API_URL ?? "http://127.0.0.1:43181";

const nextConfig: NextConfig = {
  transpilePackages: ["@nightplot/shared"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/health", destination: `${api}/health` },
    ];
  },
};

export default nextConfig;
