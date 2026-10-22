import type { Job } from "bullmq";
import { db } from "@/lib/db";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";

const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Owner: Phase 4 (adds scoring). Runs after every audit step has finished or failed.
export async function finalizeJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  await setStepState(scanId, "finalize", "running");
  await db.scan.update({
    where: { id: scanId },
    data: {
      status: "done",
      finishedAt: new Date(),
      snapshotPurgeAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
    },
  });
  await setStepState(scanId, "finalize", "done");
}
