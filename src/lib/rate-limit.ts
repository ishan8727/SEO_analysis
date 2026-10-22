import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { apiError } from "@/lib/api";
import { hashIdentifier } from "@/lib/hash";
import { getRedis } from "@/lib/redis";

// Every limit in the app lives here (SPEC.md sections 8 and 10).
export const RATE_LIMITS = {
  scanCreateIpMinute: { limit: 5, windowSec: 60 },
  scanCreateIpDay: { limit: 30, windowSec: 24 * 60 * 60 },
  scanCreatePlaceDay: { limit: 3, windowSec: 24 * 60 * 60 },
  scanStatusIp: { limit: 60, windowSec: 60 },
  assetIp: { limit: 120, windowSec: 60 },
  verifyStartIp: { limit: 3, windowSec: 10 * 60 },
  verifyStartPhone: { limit: 5, windowSec: 60 * 60 },
  verifyConfirmIp: { limit: 20, windowSec: 10 * 60 },
  webhookIp: { limit: 600, windowSec: 60 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number; // 0 when ok
}

/**
 * Sliding-window log on a Redis sorted set, keyed by a hash of the subject (IP, phone, placeId).
 * Rejected requests are not counted, so a blocked client recovers once the window slides.
 */
export async function rateLimit(
  name: RateLimitName,
  subject: string,
  redis: Redis = getRedis(),
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  const { limit, windowSec } = RATE_LIMITS[name];
  const windowMs = windowSec * 1000;
  const key = `rl:${name}:${hashIdentifier(subject)}`;
  const member = `${nowMs}:${randomUUID()}`;

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, nowMs - windowMs)
    .zadd(key, nowMs, member)
    .zcard(key)
    .pexpire(key, windowMs)
    .exec();
  const count = Number(results?.[2]?.[1] ?? 0);

  if (count <= limit) {
    return { ok: true, limit, remaining: limit - count, retryAfterSec: 0 };
  }

  await redis.zrem(key, member);
  // Members are "<timestampMs>:<uuid>", so the oldest member carries its own timestamp.
  const [oldest] = await redis.zrange(key, "0", "0");
  const oldestMs = Number(oldest?.split(":")[0] ?? nowMs);
  const retryAfterSec = Math.max(1, Math.ceil((oldestMs + windowMs - nowMs) / 1000));
  return { ok: false, limit, remaining: 0, retryAfterSec };
}

/**
 * Checks several limits in order; returns a 429 Response for the first one exceeded, else null.
 * Usage in a route: `const limited = await enforceRateLimits([["scanStatusIp", ip]]); if (limited) return limited;`
 */
export async function enforceRateLimits(
  checks: [RateLimitName, string][],
  redis: Redis = getRedis(),
): Promise<Response | null> {
  for (const [name, subject] of checks) {
    const result = await rateLimit(name, subject, redis);
    if (!result.ok) {
      return apiError(429, "RATE_LIMITED", "Too many requests", {
        "Retry-After": String(result.retryAfterSec),
      });
    }
  }
  return null;
}
