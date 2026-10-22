import type { Job } from "bullmq";
import type { PingJobData } from "@/lib/queue";
import { log } from "@/lib/log";

export async function pingJob(job: Job<PingJobData>) {
  log.info({ jobId: job.id, sentAt: job.data.sentAt }, "pong");
  return { pong: true, receivedAt: new Date().toISOString() };
}
