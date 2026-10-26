import { connection } from "next/server";
import { moliStatus } from "@/lib/browser";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/redis";

// Not rate limited: the deploy script and uptime checks call it. Exposes only up/down per dependency.

async function withTimeout(check: Promise<unknown>, ms = 3_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    await Promise.race([check, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  await connection();
  const [dbOk, redisOk, moliOk] = await Promise.all([
    withTimeout(db.$queryRaw`SELECT 1`),
    withTimeout(getRedis().ping()),
    moliStatus(),
  ]);
  const status = (ok: boolean) => (ok ? "ok" : "down");
  return Response.json(
    { db: status(dbOk), redis: status(redisOk), moli: status(moliOk) },
    { status: dbOk && redisOk && moliOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
