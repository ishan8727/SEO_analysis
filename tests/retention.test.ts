import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// Retention with the DB mocked: checks the filters it sends, not Postgres itself.

const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { scan: { updateMany: mocks.updateMany }, asset: { deleteMany: mocks.deleteMany } },
}));

const { runRetention, SCREENSHOT_MAX_AGE_DAYS } = await import("@/worker/jobs/retention");

const NOW = new Date("2026-10-26T21:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 3 });
  mocks.deleteMany.mockResolvedValue({ count: 2 });
});

describe("runRetention", () => {
  it("clears Google place snapshots whose purge date has passed", async () => {
    await runRetention(NOW);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { snapshotPurgeAt: { lt: NOW } },
      data: { placeSnapshot: Prisma.DbNull, snapshotPurgeAt: null },
    });
  });

  it("deletes only screenshots older than 90 days (PDFs stay)", async () => {
    await runRetention(NOW);
    const { where } = mocks.deleteMany.mock.calls[0][0];
    expect(where.kind).toEqual({ in: ["screenshot_mobile", "screenshot_desktop"] });
    expect(NOW.getTime() - where.createdAt.lt.getTime()).toBe(SCREENSHOT_MAX_AGE_DAYS * 86_400_000);
  });

  it("reports what it removed", async () => {
    await expect(runRetention(NOW)).resolves.toEqual({ snapshotsPurged: 3, screenshotsDeleted: 2 });
  });
});
