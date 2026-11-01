import type { NextConfig } from "next";

const api = process.env.NIGHTPLOT_API_URL ?? "http://127.0.0.1:43181";

const nextConfig: NextConfig = {
  transpilePackages: ["@nightplot/shared"],
  // Konva's Node entry optionally imports the native `canvas` package. Next's
  // dev bundler treats that as a hard dependency and the dev server never
  // finishes coming up. The browser stage does not need it.
  serverExternalPackages: ["canvas"],
  turbopack: {
    resolveAlias: {
      canvas: "./src/lib/empty-canvas.ts",
    },
  },
  webpack: (config) => {
    config.resolve.alias = { ...(config.resolve.alias ?? {}), canvas: false };
    return config;
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/health", destination: `${api}/health` },
    ];
  },
};

export default nextConfig;
