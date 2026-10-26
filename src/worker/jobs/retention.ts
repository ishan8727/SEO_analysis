import type { Job } from "bullmq";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import type { AssetKind } from "@/types";

// Nightly (scheduled in src/worker/index.ts). Google place data is cached at most 30 days: finalize sets
// snapshotPurgeAt, and this clears the snapshot once it passes. Screenshots go after 90 days.
// Scores, audits and leads are kept.

export const SCREENSHOT_MAX_AGE_DAYS = 90;
const SCREENSHOT_KINDS: AssetKind[] = ["screenshot_mobile", "screenshot_desktop"];

export async function runRetention(now = new Date()) {
  const snapshots = await db.scan.updateMany({
    where: { snapshotPurgeAt: { lt: now } },
    data: { placeSnapshot: Prisma.DbNull, snapshotPurgeAt: null },
  });
  const screenshots = await db.asset.deleteMany({
    where: {
      kind: { in: SCREENSHOT_KINDS },
      createdAt: { lt: new Date(now.getTime() - SCREENSHOT_MAX_AGE_DAYS * 86_400_000) },
    },
  });
  return { snapshotsPurged: snapshots.count, screenshotsDeleted: screenshots.count };
}

export async function retentionJob(job: Job): Promise<void> {
  const result = await runRetention();
  log.info({ jobId: job.id, ...result }, "retention done");
}
