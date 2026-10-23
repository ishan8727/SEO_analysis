import { describe, expect, it } from "vitest";
import { rankTable } from "@/lib/scoring";
import { toReport, toTeaser, type ScanRow } from "@/lib/scan-view";
import type { CompetitorsResult, Fix, GbpResult, ScoreResult, SentimentResult } from "@/types";

const competitors: CompetitorsResult = {
  radiusM: 3000,
  primaryType: "dentist",
  items: [
    { placeId: "c1", name: "Secret Rival Dental", rating: 4.9, reviewCount: 900, location: null, websiteUri: null, distanceM: 400 },
    { placeId: "c2", name: "Hidden Smile Clinic", rating: 3.9, reviewCount: 10, location: null, websiteUri: null, distanceM: 900 },
  ],
};

const sentiment: SentimentResult = {
  loves: ["UNIQUE_LOVE_TOKEN"],
  complaints: ["UNIQUE_COMPLAINT_TOKEN"],
  positiveRatio: 0.8,
  summary: "UNIQUE_SUMMARY_TOKEN",
  reviewCount: 5,
};

const gbp: GbpResult = {
  checks: { hasWebsite: true, hasPhone: true, hasHours: true, hasDescription: false, photosCount: 4, isOperational: true, hasPrimaryType: true },
  rating: 4.5,
  reviewCount: 100,
  newestReviewAt: "2026-10-01T00:00:00Z",
};

const fix = (n: number): Fix => ({ key: `k${n}`, pillar: "onPage", text: `FIX_TEXT_${n}`, pointsLost: 10 - n, effort: 1 });

const score: ScoreResult = {
  total: 62,
  grade: "C",
  pillars: { gbp: 80, reputation: 70, competitive: 50, webTech: 40, onPage: 60 },
  rank: { position: 2, of: 3 },
  fixes: [1, 2, 3, 4, 5, 6].map(fix),
};

const row = (over: Partial<ScanRow> = {}): ScanRow =>
  ({
    id: "abcdefghijklmnopqrstu",
    status: "done",
    progress: { gbp: "done", competitors: "done", psi: "done", dom: "done", sentiment: "done", finalize: "done" },
    placeSnapshot: null,
    gbp,
    competitors,
    psi: null,
    domAudit: null,
    sentiment,
    score,
    error: null,
    business: { mode: "local", name: "Sharma Dental", address: "Indiranagar", websiteUrl: "https://x.example", lat: 12.9, lng: 77.6 },
    assets: [{ kind: "screenshot_mobile" }, { kind: "pdf" }],
    ...over,
  }) as unknown as ScanRow;

describe("toTeaser", () => {
  const teaser = toTeaser(row());
  const body = JSON.stringify(teaser);

  it("contains no locked data at all", () => {
    for (const secret of ["Secret Rival Dental", "Hidden Smile Clinic", "UNIQUE_LOVE_TOKEN", "UNIQUE_COMPLAINT_TOKEN", "UNIQUE_SUMMARY_TOKEN", "FIX_TEXT_3", "FIX_TEXT_6"]) {
      expect(body).not.toContain(secret);
    }
    expect(Object.keys(teaser)).not.toEqual(expect.arrayContaining(["fixes"]));
    expect(teaser).not.toHaveProperty("competitors");
    expect(teaser).not.toHaveProperty("sentiment");
    expect(teaser).not.toHaveProperty("pdfUrl");
  });

  it("shows the score, rank, two fixes and how many are locked", () => {
    expect(teaser.unlocked).toBe(false);
    expect(teaser.score).toEqual({ total: 62, grade: "C", pillars: score.pillars, rank: { position: 2, of: 3 } });
    expect(teaser.fixesPreview.map((f) => f.text)).toEqual(["FIX_TEXT_1", "FIX_TEXT_2"]);
    expect(teaser.lockedFixCount).toBe(4);
  });

  it("links only the screenshots that exist", () => {
    expect(teaser.screenshots).toEqual({ mobile: "/api/scans/abcdefghijklmnopqrstu/assets/screenshot_mobile" });
  });

  it("reveals finished pillars while the scan is running", () => {
    const running = toTeaser(row({ status: "running", score: null, progress: { gbp: "done", competitors: "running" } }));
    expect(running.score).toBeNull();
    expect(running.partialPillars).toEqual({ gbp: 78 });
  });

  it("passes the user-safe error only for failed scans", () => {
    expect(toTeaser(row({ status: "failed", score: null, error: "We couldn't finish" })).error).toBe("We couldn't finish");
    expect(teaser.error).toBeNull();
  });
});

describe("toReport", () => {
  it("adds the locked data", () => {
    const report = toReport(row());
    expect(report.unlocked).toBe(true);
    expect(report.fixes).toHaveLength(6);
    expect(report.competitors?.items[0].name).toBe("Secret Rival Dental");
    expect(report.sentiment?.summary).toBe("UNIQUE_SUMMARY_TOKEN");
    expect(report.location).toEqual({ lat: 12.9, lng: 77.6 });
    expect(report.pdfUrl).toBe("/api/scans/abcdefghijklmnopqrstu/assets/pdf");
  });
});

describe("rankTable", () => {
  it("orders self and competitors by the rank strength", () => {
    const rows = rankTable("Sharma Dental", gbp, competitors);
    expect(rows.map((r) => r.name)).toEqual(["Secret Rival Dental", "Sharma Dental", "Hidden Smile Clinic"]);
    expect(rows[1].self).toBe(true);
  });
});
