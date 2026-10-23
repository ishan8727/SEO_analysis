import pino from "pino";

// JSON logs only (no transports: they spawn worker threads that break under Next bundling).
// Never log raw phone numbers, verification codes, ID tokens, auth headers or Google review text.
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: process.env.SERVICE_NAME ?? "web" },
  redact: {
    paths: [
      "phone",
      "phoneE164",
      "code",
      "otp",
      "token",
      "idToken",
      "authorization",
      "cookie",
      "*.phone",
      "*.phoneE164",
      "*.code",
      "*.otp",
      "*.token",
      "*.idToken",
      "*.authorization",
      "*.cookie",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[redacted]",
  },
});
