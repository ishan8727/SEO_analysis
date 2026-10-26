import pino from "pino";

// Cloud Logging severity names. On the VM the Ops Agent reads each container's JSON lines and
// moves `severity` onto the log entry, so errors show as errors in Logs Explorer.
const SEVERITY: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

// JSON logs only (no transports: they spawn worker threads that break under Next bundling).
// Never log raw phone numbers, verification codes, ID tokens, auth headers or Google review text.
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: process.env.SERVICE_NAME ?? "web" },
  // Cloud Logging uses `message` as the entry's summary line.
  messageKey: "message",
  formatters: {
    level: (label) => ({ level: label, severity: SEVERITY[label] ?? "DEFAULT" }),
  },
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
