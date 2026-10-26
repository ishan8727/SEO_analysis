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
  crmSyncedAt: null as Date | null,
  scan: { id: "AbCdEfGhIjKlMnOpQrStU", score: { total: 72, grade: "B" }, business: { name: "Smile Dental", websiteUrl: "https://smile.example" } },
};
const job = { data: { leadId: "lead_1" }, attemptsMade: 0 } as Job<{ leadId: string }>;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.env.mockReturnValue({ LEAD_WEBHOOK_URL: "https://hook.make.example/abc", APP_URL: "https://audit.thesalesinc.com" });
  mocks.findUnique.mockResolvedValue({ ...LEAD });
  fetchMock.mockResolvedValue(new Response("Accepted", { status: 200 }));
});

describe("buildLeadPayload", () => {
  it("carries the lead, business, score and report link", () => {
    expect(buildLeadPayload(LEAD, "https://audit.thesalesinc.com")).toEqual({
      event: "lead.verified",
      leadId: "lead_1",
      phone: "+919876543210",
      country: "IN",
      role: "owner",
      verifiedAt: "2026-10-26T10:00:00.000Z",
      scanId: "AbCdEfGhIjKlMnOpQrStU",
      reportUrl: "https://audit.thesalesinc.com/report/AbCdEfGhIjKlMnOpQrStU",
      business: { name: "Smile Dental", website: "https://smile.example" },
      score: { total: 72, grade: "B" },
    });
  });
});

describe("leadWebhookJob", () => {
  it("POSTs the lead and marks it synced", async () => {
    await leadWebhookJob(job);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hook.make.example/abc");
    expect(JSON.parse(init.body).leadId).toBe("lead_1");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "lead_1" }, data: { crmSyncedAt: expect.any(Date) } });
  });

  it("throws on a non-2xx answer so BullMQ retries, and doesn't mark it synced", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await expect(leadWebhookJob(job)).rejects.toThrow("503");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does nothing when the webhook is off", async () => {
    mocks.env.mockReturnValue({ LEAD_WEBHOOK_URL: "", APP_URL: "https://audit.thesalesinc.com" });
    await leadWebhookJob(job);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't send a lead twice", async () => {
    mocks.findUnique.mockResolvedValue({ ...LEAD, crmSyncedAt: new Date() });
    await leadWebhookJob(job);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
