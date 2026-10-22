import type { Job } from "bullmq";
import { log } from "@/lib/log";
import type { PdfJobData } from "@/lib/queue";

// Owner: Phase 5. Stub until the report PDF is implemented.
export async function pdfJob(job: Job<PdfJobData>): Promise<void> {
  log.warn({ scanId: job.data.scanId }, "pdf job not implemented yet");
}
