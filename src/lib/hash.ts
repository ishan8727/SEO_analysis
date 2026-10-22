import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Keyed hash for anything we must look up but never store raw:
 * client IPs (rate limits, Scan.ipHash) and verification codes.
 * HMAC-SHA256 with HASH_SALT; deterministic so it can be used as a lookup key.
 */
export function hashIdentifier(value: string): string {
  return createHmac("sha256", env().HASH_SALT).update(value).digest("hex");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
