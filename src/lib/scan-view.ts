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
  ScanReport,
  ScanTeaser,
  ScoreResult,
  SentimentResult,
} from "@/types";

// Builds the two payloads of GET /api/scans/:id from one DB row. The scan and report
// pages call the same functions, so the API and the server render never disagree.
// Locked data (competitor names, full fixes, sentiment detail) is only read in toReport().

export const SCAN_ID_RE = /^[A-Za-z0-9_-]{21}$/;

/** Fixes shown in the teaser; the next ones are locked (SPEC.md section 11: top 5, 3 locked). */
export const TEASER_FIXES = 2;

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

export function toTeaser(row: ScanRow): ScanTeaser {
  const score = row.score as unknown as ScoreResult | null;
  const kinds = new Set(row.assets.map((a) => a.kind));
  const fixes = score?.fixes ?? [];
  const teaser: ScanTeaser = {
    id: row.id,
    unlocked: false,
    status: row.status,
    mode: row.business.mode,
    progress: row.progress as ScanProgress,
    business: { name: row.business.name, address: row.business.address, websiteUrl: row.business.websiteUrl },
    countryCode: (row.placeSnapshot as unknown as PlaceSnapshot | null)?.countryCode ?? null,
    score: score && { total: score.total, grade: score.grade, pillars: score.pillars, rank: score.rank },
    screenshots: {
      ...(kinds.has("screenshot_mobile") && { mobile: assetUrl(row.id, "screenshot_mobile") }),
      ...(kinds.has("screenshot_desktop") && { desktop: assetUrl(row.id, "screenshot_desktop") }),
    },
    fixesPreview: fixes.slice(0, TEASER_FIXES),
    lockedFixCount: Math.max(0, fixes.length - TEASER_FIXES),
    error: row.status === "failed" ? row.error : null,
  };
  if (!score && row.status !== "failed") teaser.partialPillars = partialPillars(scoringInput(row));
  return teaser;
}

export function toReport(row: ScanRow): ScanReport {
  const score = row.score as unknown as ScoreResult | null;
  const { lat, lng } = row.business;
  return {
    ...toTeaser(row),
    unlocked: true,
    fixes: score?.fixes ?? [],
    gbp: row.gbp as unknown as GbpResult | null,
    competitors: row.competitors as unknown as CompetitorsResult | null,
    psi: row.psi as unknown as PsiResult | null,
    domAudit: row.domAudit as unknown as DomAuditResult | null,
    sentiment: row.sentiment as unknown as SentimentResult | null,
    location: lat !== null && lng !== null ? { lat, lng } : null,
    pdfUrl: row.assets.some((a) => a.kind === "pdf") ? assetUrl(row.id, "pdf") : null,
  };
}
