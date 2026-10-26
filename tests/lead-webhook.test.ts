import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lead webhook job with the DB, env and fetch mocked.

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), env: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { lead: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));

const { buildLeadPayload, leadWebhookJob } = await import("@/worker/jobs/lead-webhook");

const LEAD = {
  id: "lead_1",
  phoneE164: "+919876543210",
  countryCode: "IN",
  role: "owner",
  verifiedAt: new Date("2026-10-26T10:00:00Z"),
  channel: "firebase_sms",
  crmSyncedAt: null as Date | null,
  scan: {
    id: "AbCdEfGhIjKlMnOpQrStU",
    status: "done",
    createdAt: new Date("2026-10-26T09:58:00Z"),
    finishedAt: new Date("2026-10-26T09:59:00Z"),
    score: {
      total: 72,
      grade: "B",
      pillars: { gbp: 80, webTech: 60 },
      rank: { position: 3, of: 10 },
      fixes: [
        { key: "a", pillar: "gbp", text: "Add photos", pointsLost: 4, effort: 1 },
        { key: "b", pillar: "onPage", text: "Write a meta description", pointsLost: 2, effort: 1 },
      ],
    },
    placeSnapshot: {
      internationalPhoneNumber: "+91 80 1234 5678",
      googleMapsUri: "https://maps.google.com/?cid=1",
      countryCode: "IN",
      rating: 4.6, // must not be sent
      reviews: [{ text: "Great" }], // must not be sent
    },
    business: {
      name: "Smile Dental",
      websiteUrl: "https://smile.example",
      address: "12 MG Road, Bengaluru",
      primaryType: "dentist",
      placeId: "ChIJ1234567890",
      mode: "local",
    },
  },
};
const job = { data: { leadId: "lead_1" }, attemptsMade: 0 } as Job<{ leadId: string }>;
const fetchMock = vi.fn();
const APP = "https://audit.thesalesinc.com";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.env.mockReturnValue({ LEAD_WEBHOOK_URL: "https://hook.make.example/abc", APP_URL: APP });
  mocks.findUnique.mockResolvedValue({ ...LEAD });
  fetchMock.mockResolvedValue(new Response("Accepted", { status: 200 }));
});

describe("buildLeadPayload", () => {
  const payload = buildLeadPayload(LEAD, APP, new Date("2026-10-26T10:00:05Z"));

  it("carries the verified lead and their connection to the business", () => {
    expect(payload.lead).toEqual({
      id: "lead_1",
      phone: "+919876543210",
      phoneCountry: "IN",
      role: "owner",
      roleLabel: "I own the business",
      verifiedAt: "2026-10-26T10:00:00.000Z",
      verifiedBy: "firebase_sms",
    });
    expect(payload.test).toBe(false);
  });

  it("carries the business and the audit summary", () => {
    expect(payload.business).toMatchObject({
      name: "Smile Dental",
      website: "https://smile.example",
      phone: "+91 80 1234 5678",
      category: "dentist",
      country: "IN",
    });
    expect(payload.audit).toMatchObject({
      reportUrl: `${APP}/report/AbCdEfGhIjKlMnOpQrStU`,
      score: 72,
      grade: "B",
      rank: { position: 3, of: 10 },
      fixCount: 2,
      topFixes: ["Add photos", "Write a meta description"],
    });
  });

  it("leaves out Google's rating and reviews", () => {
    const text = JSON.stringify(payload);
    expect(text).not.toContain("4.6");
    expect(text).not.toContain("Great");
  });
});

describe("leadWebhookJob", () => {
  it("POSTs the lead and marks it synced", async () => {
    await leadWebhookJob(job);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hook.make.example/abc");
    expect(JSON.parse(init.body).lead.id).toBe("lead_1");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "lead_1" }, data: { crmSyncedAt: expect.any(Date) } });
  });

  it("throws on a non-2xx answer so BullMQ retries, and doesn't mark it synced", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await expect(leadWebhookJob(job)).rejects.toThrow("503");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("never sends a lead whose phone isn't verified", async () => {
    mocks.findUnique.mockResolvedValue({ ...LEAD, verifiedAt: null });
    await expect(leadWebhookJob(job)).rejects.toThrow("verified");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the webhook is off", async () => {
    mocks.env.mockReturnValue({ LEAD_WEBHOOK_URL: "", APP_URL: APP });
    await leadWebhookJob(job);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't send a lead twice", async () => {
    mocks.findUnique.mockResolvedValue({ ...LEAD, crmSyncedAt: new Date() });
    await leadWebhookJob(job);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
