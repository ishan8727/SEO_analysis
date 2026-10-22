import type { Job } from "bullmq";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";

// Owner: Phase 3. Stub: marks the step skipped so the scan flow completes end to end.
export async function competitorsJob(job: Job<ScanJobData>): Promise<void> {
  await setStepState(job.data.scanId, "competitors", "skipped");
}
