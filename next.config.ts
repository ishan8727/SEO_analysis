import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Node-only packages: keep them out of the server bundle and load them from node_modules.
  serverExternalPackages: [
    "playwright-core",
    "pino",
    "bullmq",
    "ioredis",
    "pg",
    "@prisma/client",
    "@prisma/adapter-pg",
    "undici",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
