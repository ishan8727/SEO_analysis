import { describe, expect, it } from "vitest";
import { rankTable } from "@/lib/scoring";
import { toLocked, toReport, type ScanRow } from "@/lib/scan-view";
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

describe("toLocked (not verified)", () => {
  const locked = toLocked(row());
  const body = JSON.stringify(locked);

  it("carries status only: no result of any kind", () => {
    for (const secret of ["Secret Rival Dental", "Hidden Smile Clinic", "UNIQUE_LOVE_TOKEN", "UNIQUE_COMPLAINT_TOKEN", "UNIQUE_SUMMARY_TOKEN", "FIX_TEXT_1", "FIX_TEXT_6", "screenshot", "/assets/"]) {
      expect(body).not.toContain(secret);
    }
    expect(Object.keys(locked).sort()).toEqual(
      ["business", "countryCode", "error", "id", "mode", "progress", "status", "verification"].sort(),
    );
    expect(locked.verification).toBe("not_verified");
  });

  it("sends no pillars while the scan is running", () => {
    const running = toLocked(row({ status: "running", score: null, progress: { gbp: "done", competitors: "running" } }));
    expect(running).not.toHaveProperty("partialPillars");
    expect(running.progress).toEqual({ gbp: "done", competitors: "running" });
  });

  it("passes the user-safe error only for failed scans", () => {
    expect(toLocked(row({ status: "failed", score: null, error: "We couldn't finish" })).error).toBe("We couldn't finish");
    expect(locked.error).toBeNull();
  });
});

describe("toReport (verified)", () => {
  const report = toReport(row());

  it("has the score, every fix and the locked data", () => {
    expect(report.verification).toBe("verified");
    expect(report.score).toEqual({ total: 62, grade: "C", pillars: score.pillars, rank: { position: 2, of: 3 } });
    expect(report.fixes).toHaveLength(6);
    expect(report.competitors?.items[0].name).toBe("Secret Rival Dental");
    expect(report.sentiment?.summary).toBe("UNIQUE_SUMMARY_TOKEN");
    expect(report.location).toEqual({ lat: 12.9, lng: 77.6 });
    expect(report.pdfUrl).toBe("/api/scans/abcdefghijklmnopqrstu/assets/pdf");
  });

  it("links only the screenshots that exist", () => {
    expect(report.screenshots).toEqual({ mobile: "/api/scans/abcdefghijklmnopqrstu/assets/screenshot_mobile" });
  });

  it("reveals finished pillars while the scan is running", () => {
    const running = toReport(row({ status: "running", score: null, progress: { gbp: "done", competitors: "running" } }));
    expect(running.score).toBeNull();
    expect(running.partialPillars).toEqual({ gbp: 78 });
  });
});

describe("rankTable", () => {
  it("orders self and competitors by the rank strength", () => {
    const rows = rankTable("Sharma Dental", gbp, competitors);
    expect(rows.map((r) => r.name)).toEqual(["Secret Rival Dental", "Sharma Dental", "Hidden Smile Clinic"]);
    expect(rows[1].self).toBe(true);
  });
});
