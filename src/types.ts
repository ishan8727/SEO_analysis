// Shared contracts between phases. Each blob below is stored in a Json column on Scan.
// Rule for parallel work: you may ADD optional fields; renaming or removing a field
// needs every phase that reads it to agree (see phases/README.md).

/* ---------- Scan progress (Scan.progress) ---------- */

export const PROGRESS_STEPS = ["gbp", "competitors", "psi", "dom", "sentiment", "finalize"] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];
export type StepState = "pending" | "running" | "done" | "failed" | "skipped";
export type ScanProgress = Partial<Record<ProgressStep, StepState>>;

/** Steps that run for each mode. "finalize" always runs last. */
export const STEPS_BY_MODE = {
  local: ["gbp", "competitors", "psi", "dom", "sentiment"],
  online: ["psi", "dom"],
} as const satisfies Record<"local" | "online", readonly ProgressStep[]>;

/* ---------- Google place data (Scan.placeSnapshot) — written by Phase 2 ---------- */

export interface PlaceReview {
  rating: number; // 1..5
  text: string | null;
  publishTime: string; // ISO
}

/** Trimmed Places API (New) Place Details. Google content: purge after 30 days. */
export interface PlaceSnapshot {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  location: { lat: number; lng: number } | null;
  websiteUri: string | null;
  nationalPhoneNumber: string | null;
  /** Optional: snapshots taken before the international pass don't have them. */
  internationalPhoneNumber?: string | null; // "+44 20 7946 0958"
  countryCode?: string | null; // ISO 3166-1 alpha-2 from addressComponents, e.g. "GB"
  rating: number | null;
  userRatingCount: number;
  reviews: PlaceReview[]; // Places returns at most 5
  weekdayHours: string[] | null; // regularOpeningHours.weekdayDescriptions
  photosCount: number;
  businessStatus: string | null; // "OPERATIONAL" | "CLOSED_TEMPORARILY" | ...
  primaryType: string | null;
  editorialSummary: string | null;
  googleMapsUri: string | null;
  fetchedAt: string; // ISO
}

/* ---------- Audit blobs — written by Phase 3 jobs ---------- */

/** Scan.gbp. Keys of `checks` mirror config/scoring.json → gbp. */
export interface GbpResult {
  checks: {
    hasWebsite: boolean;
    hasPhone: boolean;
    hasHours: boolean;
    hasDescription: boolean;
    photosCount: number;
    isOperational: boolean;
    hasPrimaryType: boolean;
  };
  rating: number | null;
  reviewCount: number;
  newestReviewAt: string | null; // ISO, from PlaceSnapshot.reviews
}

export interface Competitor {
  placeId: string;
  name: string;
  rating: number | null;
  reviewCount: number;
  location: { lat: number; lng: number } | null;
  websiteUri: string | null;
  distanceM: number | null;
}

/** Scan.competitors. Never contains the scanned business itself. */
export interface CompetitorsResult {
  radiusM: number;
  primaryType: string | null;
  items: Competitor[];
}

export interface PsiStrategyResult {
  // Lighthouse category scores, 0..1
  performance: number | null;
  seo: number | null;
  bestPractices: number | null;
  accessibility: number | null;
  cwv: {
    lcpMs: number | null;
    cls: number | null;
    inpMs: number | null; // field data, often missing
    fcpMs: number | null;
    tbtMs: number | null;
  };
  cwvPass: boolean | null; // field data overall_category === "FAST"; null if no field data
  viewport: boolean; // Lighthouse "viewport" audit passed
  failingSeoAudits: { id: string; title: string }[];
}

/** Scan.psi */
export interface PsiResult {
  url: string;
  https: boolean;
  mobile: PsiStrategyResult | null;
  desktop: PsiStrategyResult | null;
}

/** Scan.domAudit */
export interface DomAuditResult {
  renderer: "moli" | "fallback";
  finalUrl: string;
  httpStatus: number | null;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  viewport: boolean;
  h1Count: number;
  h2Count: number;
  jsonLdTypes: string[];
  hasLocalSchema: boolean; // LocalBusiness or a subtype in JSON-LD
  ogTags: Record<string, string>;
  images: { total: number; missingAlt: number };
  links: { internal: number; external: number; tel: number; whatsapp: number; maps: number };
  keywordHits: { ordering: boolean; booking: boolean };
  robotsTxt: boolean;
  sitemapXml: boolean;
  /**
   * Local mode only; null in online mode. Each part 0..1. A part Google has no data for
   * (e.g. no phone) reads 0 and is left out of `score`.
   */
  napMatch: { name: number; address: number; phone: number; score: number } | null;
}

/** Scan.sentiment — Gemini output plus bookkeeping. */
export interface SentimentResult {
  loves: string[];
  complaints: string[];
  positiveRatio: number; // 0..1
  summary: string;
  reviewCount: number; // reviews the model saw
}

/* ---------- Score (Scan.score) — written by Phase 4 finalize ---------- */

export const PILLARS = ["gbp", "reputation", "competitive", "webTech", "onPage"] as const;
export type Pillar = (typeof PILLARS)[number];
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface Fix {
  key: string; // stable id, e.g. "onPage.metaDescription"
  pillar: Pillar;
  text: string;
  pointsLost: number; // points of the 0..100 total
  effort: 1 | 2 | 3;
}

export interface ScoreResult {
  total: number; // 0..100, rounded
  grade: Grade;
  pillars: Partial<Record<Pillar, number>>; // each 0..100; absent pillars were not scored (online mode)
  rank: { position: number; of: number } | null; // "You rank #N of M nearby"
  fixes: Fix[]; // sorted by pointsLost / effort, descending
}

/* ---------- Files (Asset table) ---------- */

export const ASSET_KINDS = ["screenshot_mobile", "screenshot_desktop", "pdf"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/* ---------- API payloads for GET /api/scans/:id — Phase 4 builds them ---------- */

export interface ScanTeaser {
  id: string;
  unlocked: false;
  status: "queued" | "running" | "done" | "failed";
  mode: "local" | "online";
  progress: ScanProgress;
  business: { name: string; address: string | null; websiteUrl: string | null };
  /** ISO country of the business from Google (null in online mode or after the snapshot purge). */
  countryCode: string | null;
  score: Pick<ScoreResult, "total" | "grade" | "pillars" | "rank"> | null;
  /** While running: pillars whose steps have all ended (src/lib/scoring.ts partialPillars). */
  partialPillars?: Partial<Record<Pillar, number>>;
  screenshots: Partial<Record<"mobile" | "desktop", string>>; // URLs
  fixesPreview: Fix[]; // top fixes not locked (spec: 5 shown, 3 locked → 2 here)
  lockedFixCount: number;
  error: string | null;
}

export interface ScanReport extends Omit<ScanTeaser, "unlocked"> {
  unlocked: true;
  fixes: Fix[];
  gbp: GbpResult | null;
  competitors: CompetitorsResult | null;
  psi: PsiResult | null;
  domAudit: DomAuditResult | null;
  sentiment: SentimentResult | null;
  location: { lat: number; lng: number } | null;
  pdfUrl: string | null;
}

/* ---------- Errors ---------- */

export type ApiErrorCode =
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "CAPTCHA_FAILED"
  | "NOT_FOUND"
  | "SCAN_FAILED"
  | "VERIFY_FAILED"
  | "COUNTRY_NOT_SUPPORTED"
  | "UNAUTHORIZED"
  | "INTERNAL";
