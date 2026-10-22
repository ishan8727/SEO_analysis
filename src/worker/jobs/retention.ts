import type { Job } from "bullmq";
import { log } from "@/lib/log";

// Owner: Phase 6. Nightly repeatable job: null expired placeSnapshot, delete old screenshots.
export async function retentionJob(job: Job): Promise<void> {
  log.warn({ jobId: job.id }, "retention job not implemented yet");
}
