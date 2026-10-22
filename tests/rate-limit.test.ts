import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enforceRateLimits, RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

// Runs against a real Redis (database 15, flushed before each test), because the
// sliding window depends on Redis MULTI + sorted-set semantics.
// Locally: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis
const TEST_REDIS_URL = process.env.REDIS_TEST_URL ?? "redis://localhost:6379/15";
let redis: Redis;

beforeAll(async () => {
  redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await redis.connect();
  } catch {
    throw new Error(`Redis not reachable at ${TEST_REDIS_URL}. Start it with: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis`);
  }
});

afterAll(async () => {
  await redis?.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe("rateLimit", () => {
  it("allows up to the limit, then blocks with Retry-After", async () => {
    const { limit } = RATE_LIMITS.scanCreateIpMinute; // 5 per minute
    const t0 = 1_000_000;
    for (let i = 0; i < limit; i++) {
      const r = await rateLimit("scanCreateIpMinute", "1.2.3.4", redis, t0 + i);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(limit - i - 1);
    }
    const blocked = await rateLimit("scanCreateIpMinute", "1.2.3.4", redis, t0 + 10_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    // Oldest hit at t0 leaves the 60 s window at t0 + 60 s → 50 s from t0 + 10 s.
    expect(blocked.retryAfterSec).toBe(50);
  });

  it("does not count rejected requests, so the client recovers when the window slides", async () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i++) await rateLimit("scanCreateIpMinute", "ip", redis, t0);
    for (let i = 0; i < 20; i++) {
      expect((await rateLimit("scanCreateIpMinute", "ip", redis, t0 + 1_000)).ok).toBe(false);
    }
    expect((await rateLimit("scanCreateIpMinute", "ip", redis, t0 + 60_001)).ok).toBe(true);
  });

  it("keeps subjects and limit names independent", async () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 5; i++) await rateLimit("scanCreateIpMinute", "a", redis, t0);
    expect((await rateLimit("scanCreateIpMinute", "a", redis, t0)).ok).toBe(false);
    expect((await rateLimit("scanCreateIpMinute", "b", redis, t0)).ok).toBe(true);
    expect((await rateLimit("scanStatusIp", "a", redis, t0)).ok).toBe(true);
  });

  it("never stores the raw subject in Redis keys", async () => {
    await rateLimit("verifyStartPhone", "+919876543210", redis);
    const keys = await redis.keys("*");
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("9876543210");
  });
});

describe("enforceRateLimits", () => {
  it("returns a typed 429 with Retry-After for the first exceeded limit", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await enforceRateLimits([["verifyStartIp", "ip"]], redis)).toBeNull();
    }
    const res = await enforceRateLimits([["verifyStartIp", "ip"]], redis);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await res?.json()).toEqual({ error: "Too many requests", code: "RATE_LIMITED" });
  });
});
