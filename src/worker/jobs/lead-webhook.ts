import { UnrecoverableError, type Job } from "bullmq";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { LeadJobData } from "@/lib/queue";
import type { PlaceSnapshot, ScoreResult } from "@/types";

// Sends a verified lead to Make.com (LEAD_WEBHOOK_URL), queued by /api/verify/confirm only after the
// phone number is confirmed by OTP. A non-2xx answer throws, so BullMQ retries (6 attempts, backoff
// from 30 s); success sets crmSyncedAt, so a lead is sent once.
// The URL is our own config, not user input, so plain fetch (no SSRF guard). Never log the phone.
// Google's rating, reviews and hours are left out: we may keep those 30 days at most, a CRM keeps forever.

const TIMEOUT_MS = 15_000;
const TOP_FIXES = 5;

/** The answer to "How are you connected to this business?" in the gate. */
const ROLE_LABELS: Record<string, string> = {
  owner: "I own the business",
  founder: "Founder / partner",
  marketing: "Marketing team",
  agency: "Agency / consultant",
  other: "Something else",
};

export interface LeadPayload {
  event: "lead.verified";
  test: boolean;
  sentAt: string;
  lead: {
    id: string;
    phone: string; // E.164, confirmed by SMS code
    phoneCountry: string | null;
    role: string;
    roleLabel: string;
    verifiedAt: string | null;
    verifiedBy: string;
  };
  business: {
    name: string;
    website: string | null;
    address: string | null;
    phone: string | null;
    googleMapsUrl: string | null;
    category: string | null;
    country: string | null;
    placeId: string | null;
    mode: string; // "local" (Google profile) | "online" (website only)
  };
  audit: {
    scanId: string;
    reportUrl: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    score: number | null;
    grade: string | null;
    pillars: ScoreResult["pillars"];
    rank: { position: number; of: number } | null;
    fixCount: number;
    topFixes: string[];
  };
}

export interface LeadRow {
  id: string;
  phoneE164: string;
  countryCode: string | null;
  role: string;
  verifiedAt: Date | null;
  channel: string;
  scan: {
    id: string;
    status: string;
    createdAt: Date;
    finishedAt: Date | null;
    score: unknown;
    placeSnapshot: unknown;
    business: {
      name: string;
      websiteUrl: string | null;
      address: string | null;
      primaryType: string | null;
      placeId: string | null;
      mode: string;
    };
  };
}

export function buildLeadPayload(lead: LeadRow, appUrl: string, now = new Date(), test = false): LeadPayload {
  const { scan } = lead;
  const score = scan.score as ScoreResult | null;
  const place = scan.placeSnapshot as PlaceSnapshot | null;
  return {
    event: "lead.verified",
    test,
    sentAt: now.toISOString(),
    lead: {
      id: lead.id,
      phone: lead.phoneE164,
      phoneCountry: lead.countryCode,
      role: lead.role,
      roleLabel: ROLE_LABELS[lead.role] ?? lead.role,
      verifiedAt: lead.verifiedAt?.toISOString() ?? null,
      verifiedBy: lead.channel,
    },
    business: {
      name: scan.business.name,
      website: scan.business.websiteUrl,
      address: scan.business.address,
      phone: place?.internationalPhoneNumber ?? place?.nationalPhoneNumber ?? null,
      googleMapsUrl: place?.googleMapsUri ?? null,
      category: scan.business.primaryType,
      country: place?.countryCode ?? null,
      placeId: scan.business.placeId,
      mode: scan.business.mode,
    },
    audit: {
      scanId: scan.id,
      reportUrl: new URL(`/report/${scan.id}`, appUrl).toString(),
      status: scan.status,
      startedAt: scan.createdAt.toISOString(),
      finishedAt: scan.finishedAt?.toISOString() ?? null,
      score: score?.total ?? null,
      grade: score?.grade ?? null,
      pillars: score?.pillars ?? {},
      rank: score?.rank ?? null,
      fixCount: score?.fixes.length ?? 0,
      topFixes: score?.fixes.slice(0, TOP_FIXES).map((f) => f.text) ?? [],
    },
  };
}

export async function postLead(url: string, payload: LeadPayload): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`lead webhook answered ${res.status}`);
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
      channel: true,
      crmSyncedAt: true,
      scan: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          finishedAt: true,
          score: true,
          placeSnapshot: true,
          business: {
            select: { name: true, websiteUrl: true, address: true, primaryType: true, placeId: true, mode: true },
          },
        },
      },
    },
  });
  if (!lead) throw new UnrecoverableError("lead not found");
  if (lead.crmSyncedAt) return; // already sent (e.g. the visitor verified twice)
  if (!lead.verifiedAt) throw new UnrecoverableError("lead isn't verified"); // only OTP-confirmed leads go out

  await postLead(url, buildLeadPayload(lead, APP_URL));
  await db.lead.update({ where: { id: leadId }, data: { crmSyncedAt: new Date() } });
  log.info({ leadId, attempt: job.attemptsMade + 1 }, "lead sent to webhook");
}
