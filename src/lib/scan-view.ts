import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { computeScore, partialPillars, type ScoringInput } from "@/lib/scoring";
import type {
  AssetKind,
  CompetitorsResult,
  DomAuditResult,
  GbpResult,
  PlaceSnapshot,
  PsiResult,
  ScanProgress,
  ScanLocked,
  ScanReport,
  ScoreResult,
  SentimentResult,
} from "@/types";

// Builds the two payloads of GET /api/scans/:id from one DB row. The scan and report
// pages call the same functions, so the API and the server render never disagree.
// Results (score, pillars, screenshots, fixes, competitors, sentiment) are only read in toReport(),
// which callers use only for a verified visitor (valid unlock cookie).

export const SCAN_ID_RE = /^[A-Za-z0-9_-]{21}$/;

const scanSelect = {
  id: true,
  status: true,
  progress: true,
  placeSnapshot: true,
  gbp: true,
  competitors: true,
  psi: true,
  domAudit: true,
  sentiment: true,
  score: true,
  error: true,
  business: { select: { mode: true, name: true, address: true, websiteUrl: true, lat: true, lng: true } },
  assets: { select: { kind: true } }, // never the bytes
} satisfies Prisma.ScanSelect;

export type ScanRow = Prisma.ScanGetPayload<{ select: typeof scanSelect }>;

export async function loadScanRow(id: string): Promise<ScanRow | null> {
  if (!SCAN_ID_RE.test(id)) return null;
  return db.scan.findUnique({ where: { id }, select: scanSelect });
}

export function scoringInput(row: ScanRow, now = new Date()): ScoringInput {
  const snapshot = row.placeSnapshot as unknown as PlaceSnapshot | null;
  return {
    mode: row.business.mode,
    websiteUrl: row.business.websiteUrl,
    progress: row.progress as ScanProgress,
    gbp: row.gbp as unknown as GbpResult | null,
    competitors: row.competitors as unknown as CompetitorsResult | null,
    psi: row.psi as unknown as PsiResult | null,
    domAudit: row.domAudit as unknown as DomAuditResult | null,
    sentiment: row.sentiment as unknown as SentimentResult | null,
    reviews: snapshot?.reviews ?? [],
    now,
  };
}

/** Runs the scoring for a finished scan (finalize job). */
export function scoreScan(row: ScanRow, now = new Date()): ScoreResult {
  return computeScore(scoringInput(row, now));
}

export function assetUrl(scanId: string, kind: AssetKind): string {
  return `/api/scans/${scanId}/assets/${kind}`;
}

/** Not verified: status only. No result field may be added here (tests/scan-view.test.ts). */
export function toLocked(row: ScanRow): ScanLocked {
  return {
    id: row.id,
    verification: "not_verified",
    status: row.status,
    mode: row.business.mode,
    progress: row.progress as ScanProgress,
    business: { name: row.business.name, address: row.business.address, websiteUrl: row.business.websiteUrl },
    countryCode: (row.placeSnapshot as unknown as PlaceSnapshot | null)?.countryCode ?? null,
    error: row.status === "failed" ? row.error : null,
  };
}

export function toReport(row: ScanRow): ScanReport {
  const score = row.score as unknown as ScoreResult | null;
  const kinds = new Set(row.assets.map((a) => a.kind));
  const { lat, lng } = row.business;
  const report: ScanReport = {
    ...toLocked(row),
    verification: "verified",
    score: score && { total: score.total, grade: score.grade, pillars: score.pillars, rank: score.rank },
    screenshots: {
      ...(kinds.has("screenshot_mobile") && { mobile: assetUrl(row.id, "screenshot_mobile") }),
      ...(kinds.has("screenshot_desktop") && { desktop: assetUrl(row.id, "screenshot_desktop") }),
    },
    fixes: score?.fixes ?? [],
    gbp: row.gbp as unknown as GbpResult | null,
    competitors: row.competitors as unknown as CompetitorsResult | null,
    psi: row.psi as unknown as PsiResult | null,
    domAudit: row.domAudit as unknown as DomAuditResult | null,
    sentiment: row.sentiment as unknown as SentimentResult | null,
    location: lat !== null && lng !== null ? { lat, lng } : null,
    pdfUrl: kinds.has("pdf") ? assetUrl(row.id, "pdf") : null,
  };
  if (!score && row.status !== "failed") report.partialPillars = partialPillars(scoringInput(row));
  return report;
}
