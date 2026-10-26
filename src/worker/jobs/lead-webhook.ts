import { UnrecoverableError, type Job } from "bullmq";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { LeadJobData } from "@/lib/queue";
import type { ScoreResult } from "@/types";

// Sends a verified lead to Make.com (LEAD_WEBHOOK_URL), queued by /api/verify/confirm.
// A non-2xx answer throws, so BullMQ retries (6 attempts, backoff from 30 s); success sets crmSyncedAt.
// The URL is our own config, not user input, so plain fetch (no SSRF guard). Never log the phone.

const TIMEOUT_MS = 15_000;

export interface LeadPayload {
  event: "lead.verified";
  leadId: string;
  phone: string; // E.164
  country: string | null;
  role: string;
  verifiedAt: string | null;
  scanId: string;
  reportUrl: string;
  business: { name: string; website: string | null };
  score: { total: number; grade: string } | null;
}

interface LeadRow {
  id: string;
  phoneE164: string;
  countryCode: string | null;
  role: string;
  verifiedAt: Date | null;
  scan: { id: string; score: unknown; business: { name: string; websiteUrl: string | null } };
}

export function buildLeadPayload(lead: LeadRow, appUrl: string): LeadPayload {
  const score = lead.scan.score as Pick<ScoreResult, "total" | "grade"> | null;
  return {
    event: "lead.verified",
    leadId: lead.id,
    phone: lead.phoneE164,
    country: lead.countryCode,
    role: lead.role,
    verifiedAt: lead.verifiedAt?.toISOString() ?? null,
    scanId: lead.scan.id,
    reportUrl: new URL(`/report/${lead.scan.id}`, appUrl).toString(),
    business: { name: lead.scan.business.name, website: lead.scan.business.websiteUrl },
    score: score ? { total: score.total, grade: score.grade } : null,
  };
}

export async function leadWebhookJob(job: Job<LeadJobData>): Promise<void> {
  const { leadId } = job.data;
  const { LEAD_WEBHOOK_URL: url, APP_URL } = env();
  if (!url) {
    log.info({ leadId }, "lead webhook off (LEAD_WEBHOOK_URL empty); lead stays in Postgres");
    return;
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      phoneE164: true,
      countryCode: true,
      role: true,
      verifiedAt: true,
      crmSyncedAt: true,
      scan: { select: { id: true, score: true, business: { select: { name: true, websiteUrl: true } } } },
    },
  });
  if (!lead) throw new UnrecoverableError("lead not found");
  if (lead.crmSyncedAt) return; // already sent (e.g. the visitor verified twice)

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildLeadPayload(lead, APP_URL)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`lead webhook answered ${res.status}`);

  await db.lead.update({ where: { id: leadId }, data: { crmSyncedAt: new Date() } });
  log.info({ leadId, attempt: job.attemptsMade + 1 }, "lead sent to webhook");
}
