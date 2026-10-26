import { z } from "zod";

// Server-only configuration. Nothing here may be prefixed NEXT_PUBLIC_.
// Parsed lazily so `next build` and unit tests don't need a full .env.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Secrets for hashing IPs/codes and signing unlock cookies.
  HASH_SALT: z.string().min(16, "HASH_SALT must be at least 16 chars"),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 chars"),
  INTERNAL_TOKEN: z.string().default(""),

  GOOGLE_SERVER_KEY: z.string().default(""),
  PSI_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),

  MOLI_URL: z.string().default("http://localhost:9222"),
  MOLI_TOKEN: z.string().default(""),

  TURNSTILE_SECRET: z.string().default(""),

  // Firebase project whose phone-auth ID tokens we accept (firebase-admin needs only the id).
  FIREBASE_PROJECT_ID: z.string().default(""),
  // How the worker reaches the web app over the private network (print page for the PDF).
  INTERNAL_APP_URL: z.url().default("http://localhost:3000"),

  // Make.com webhook that receives verified leads (worker job lead-webhook). Empty = off; leads stay in Postgres.
  LEAD_WEBHOOK_URL: z.union([z.literal(""), z.url()]).default(""),

  CRM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  SCAN_CACHE_DAYS: z.coerce.number().int().positive().default(7),
  // Phone gate's last-resort country code when the business has none.
  DEFAULT_COUNTRY: z.string().length(2).default("IN"),
  // "Online only" mode (audit a website without a Google profile). Also a Docker build arg.
  ONLINE_MODE: z.enum(["on", "off"]).default("on"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
