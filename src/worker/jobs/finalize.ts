import type { Job } from "bullmq";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";
import { loadScanRow, scoreScan } from "@/lib/scan-view";

const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Runs after every audit step has finished or failed: scores the scan and marks it done.
export async function finalizeJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  await setStepState(scanId, "finalize", "running");
  const row = await loadScanRow(scanId);
  if (!row) throw new Error(`Scan ${scanId} not found`);

  const score = scoreScan(row);
  await db.scan.update({
    where: { id: scanId },
    data: {
      score: score as unknown as Prisma.InputJsonObject,
      status: "done",
      finishedAt: new Date(),
      snapshotPurgeAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
    },
  });
  await setStepState(scanId, "finalize", "done");
}
