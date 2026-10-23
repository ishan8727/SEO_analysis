import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Local hostname mapped to 127.0.0.1 in the hosts file: Firebase phone auth rejects real
  // reCAPTCHA tokens from `localhost` (firebase-js-sdk#8387), so the gate is tested here instead.
  allowedDevOrigins: ["dev.thesalesinc.com"],
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
    "firebase-admin",
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
