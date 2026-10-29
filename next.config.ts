import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Local hostname mapped to 127.0.0.1 in the hosts file: Firebase phone auth rejects real
  // reCAPTCHA tokens from `localhost` (firebase-js-sdk#8387), so the gate is tested here instead.
  allowedDevOrigins: ["dev.example.com"],
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
  // CSP, frame, referrer and HSTS headers on every route (SPEC.md section 10).
  async headers() {
    const headers = securityHeaders({
      isDev: process.env.NODE_ENV === "development",
      firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    });
    return [{ source: "/:path*", headers }];
  },
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
