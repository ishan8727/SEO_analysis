import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { JOB, SCAN_QUEUE, type JobName, type ScanJobData } from "@/lib/queue";
import { createQueueConnection } from "@/lib/redis";
import { markScanFailed } from "@/lib/scan-progress";
import { competitorsJob } from "@/worker/jobs/competitors";
import { domAuditJob } from "@/worker/jobs/dom-audit";
import { finalizeJob } from "@/worker/jobs/finalize";
import { gbpJob } from "@/worker/jobs/gbp";
import { pdfJob } from "@/worker/jobs/pdf";
import { pingJob } from "@/worker/jobs/ping";
import { psiJob } from "@/worker/jobs/psi";
import { retentionJob } from "@/worker/jobs/retention";
import { sentimentJob } from "@/worker/jobs/sentiment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler narrows its own job data
const handlers: Record<JobName, (job: Job<any>) => Promise<unknown>> = {
  [JOB.ping]: pingJob,
  [JOB.gbp]: gbpJob,
  [JOB.competitors]: competitorsJob,
  [JOB.psi]: psiJob,
  [JOB.dom]: domAuditJob,
  [JOB.sentiment]: sentimentJob,
  [JOB.finalize]: finalizeJob,
  [JOB.pdf]: pdfJob,
  [JOB.retention]: retentionJob,
};

const worker = new Worker(
  SCAN_QUEUE,
  async (job) => {
    const handler = handlers[job.name as JobName];
    if (!handler) throw new Error(`Unknown job: ${job.name}`);
    return handler(job);
  },
  {
    connection: createQueueConnection(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  },
);

worker.on("ready", () => log.info({ queue: SCAN_QUEUE }, "worker ready"));
worker.on("completed", (job) => log.info({ jobId: job.id, name: job.name }, "job completed"));
worker.on("error", (err) => log.error({ err: err.message }, "worker error"));
worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, name: job?.name, attempt: job?.attemptsMade, err: err.message }, "job failed");
  // If finalize gives up, the scan can never complete: tell the user instead of spinning forever.
  const finalAttempt = job && job.attemptsMade >= (job.opts.attempts ?? 1);
  if (job?.name === JOB.finalize && finalAttempt) {
    const { scanId } = job.data as ScanJobData;
    markScanFailed(scanId, "We couldn't finish this audit. Please try again in a few minutes.").catch((e) =>
      log.error({ scanId, err: (e as Error).message }, "could not mark scan failed"),
    );
  }
});

async function shutdown(signal: string) {
  log.info({ signal }, "worker shutting down");
  await worker.close();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
