import { FlowProducer, Queue, type JobsOptions } from "bullmq";
import { createQueueConnection } from "@/lib/redis";
import { STEPS_BY_MODE } from "@/types";

// One BullMQ queue; job names below. Handlers live in src/worker/jobs/.

export const SCAN_QUEUE = "scan";

export const JOB = {
  ping: "ping",
  gbp: "gbp",
  competitors: "competitors",
  psi: "psi",
  dom: "dom",
  sentiment: "sentiment",
  finalize: "finalize",
  pdf: "pdf",
  retention: "retention",
  leadWebhook: "lead-webhook",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export interface ScanJobData {
  scanId: string;
}
export interface PdfJobData {
  scanId: string;
  leadId: string;
}
export interface LeadJobData {
  leadId: string;
}
export interface PingJobData {
  sentAt: string;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};

const globalForQueue = globalThis as unknown as { scanQueue?: Queue; flowProducer?: FlowProducer };

export function getScanQueue(): Queue {
  globalForQueue.scanQueue ??= new Queue(SCAN_QUEUE, {
    connection: createQueueConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return globalForQueue.scanQueue;
}

function getFlowProducer(): FlowProducer {
  globalForQueue.flowProducer ??= new FlowProducer({ connection: createQueueConnection() });
  return globalForQueue.flowProducer;
}

/**
 * Enqueues a scan: the audit steps for the mode run in parallel, then `finalize` runs
 * once all of them have finished, even if some failed (ignoreDependencyOnFailure).
 * Job ids are derived from the scan id, so enqueueing the same scan twice is a no-op.
 */
export async function enqueueScan(scanId: string, mode: "local" | "online"): Promise<void> {
  await getFlowProducer().add({
    name: JOB.finalize,
    queueName: SCAN_QUEUE,
    data: { scanId } satisfies ScanJobData,
    opts: { ...DEFAULT_JOB_OPTIONS, jobId: `${scanId}-finalize` },
    children: STEPS_BY_MODE[mode].map((step) => ({
      name: step,
      queueName: SCAN_QUEUE,
      data: { scanId } satisfies ScanJobData,
      opts: { ...DEFAULT_JOB_OPTIONS, jobId: `${scanId}-${step}`, ignoreDependencyOnFailure: true },
    })),
  });
}

export async function enqueuePdf(scanId: string, leadId: string) {
  return getScanQueue().add(JOB.pdf, { scanId, leadId } satisfies PdfJobData, {
    jobId: `${scanId}-pdf-${leadId}`,
  });
}

/** Sends a verified lead to LEAD_WEBHOOK_URL. More retries than scan steps: Make.com may be briefly down. */
export async function enqueueLeadWebhook(leadId: string) {
  return getScanQueue().add(JOB.leadWebhook, { leadId } satisfies LeadJobData, {
    jobId: `lead-${leadId}`,
    attempts: 6,
    backoff: { type: "exponential", delay: 30_000 },
  });
}

export async function enqueuePing() {
  return getScanQueue().add(JOB.ping, { sentAt: new Date().toISOString() } satisfies PingJobData);
}
