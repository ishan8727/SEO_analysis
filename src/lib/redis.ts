import { Redis } from "ioredis";

const url = () => process.env.REDIS_URL ?? "redis://localhost:6379";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/** Shared connection for rate limits, caches and health checks. Connects on first command. */
export function getRedis(): Redis {
  globalForRedis.redis ??= new Redis(url(), { lazyConnect: true, maxRetriesPerRequest: 2 });
  return globalForRedis.redis;
}

/** BullMQ needs dedicated connections with maxRetriesPerRequest: null. */
export function createQueueConnection(): Redis {
  return new Redis(url(), { maxRetriesPerRequest: null });
}
