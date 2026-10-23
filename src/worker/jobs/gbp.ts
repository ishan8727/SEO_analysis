import { UnrecoverableError, type Job } from "bullmq";
import { toGbpResult } from "@/lib/google/places";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";
import { loadScan, saveBlob } from "@/worker/scan-context";

// Google Business Profile checklist, computed from the snapshot taken at intake. No API calls.
export async function gbpJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  await setStepState(scanId, "gbp", "running");
  const { snapshot } = await loadScan(scanId);
  if (!snapshot) throw new UnrecoverableError("Scan has no place snapshot");

  await saveBlob(scanId, "gbp", toGbpResult(snapshot));
  await setStepState(scanId, "gbp", "done");
}
