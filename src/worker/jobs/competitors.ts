import { UnrecoverableError, type Job } from "bullmq";
import { env } from "@/lib/env";
import { searchNearby } from "@/lib/google/places";
import { log } from "@/lib/log";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";
import { loadScan, saveBlob } from "@/worker/scan-context";

// Nearby places of the same primary type (Places Nearby Search). Never scrapes Google.
export async function competitorsJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  const { snapshot } = await loadScan(scanId);
  if (!snapshot) throw new UnrecoverableError("Scan has no place snapshot");
  if (!snapshot.location || !snapshot.primaryType) {
    log.info({ scanId }, "competitors skipped: place has no location or primary type");
    await setStepState(scanId, "competitors", "skipped");
    return;
  }
  if (!env().GOOGLE_SERVER_KEY) throw new UnrecoverableError("GOOGLE_SERVER_KEY is not set");

  await setStepState(scanId, "competitors", "running");
  const result = await searchNearby({
    placeId: snapshot.placeId,
    location: snapshot.location,
    primaryType: snapshot.primaryType,
  });
  await saveBlob(scanId, "competitors", result);
  await setStepState(scanId, "competitors", "done");
}
