import config from "../../config/scoring.json";
import type {
  CompetitorsResult,
  DomAuditResult,
  Fix,
  GbpResult,
  Grade,
  Pillar,
  PlaceReview,
  ProgressStep,
  PsiResult,
  ScanProgress,
  ScoreResult,
  SentimentResult,
} from "@/types";

// Scoring (SPEC.md section 11). Pure functions over the scan's audit blobs; all weights
// and thresholds come from config/scoring.json. A null blob (step failed or skipped)
// scores like missing data.

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_COMPETITOR_REVIEWS = 50; // volumeNorm denominator when there are no competitors
const MIN_POINTS_LOST = 0.5; // smaller losses aren't worth a fix

export interface ScoringInput {
  mode: "local" | "online";
  websiteUrl: string | null;
  progress: ScanProgress;
  gbp: GbpResult | null;
  competitors: CompetitorsResult | null;
  psi: PsiResult | null;
  domAudit: DomAuditResult | null;
  sentiment: SentimentResult | null;
  reviews: PlaceReview[]; // PlaceSnapshot.reviews; sentiment fallback when Gemini didn't run
  now?: Date;
}

/** One checklist line of a pillar. A pillar scores 100 × Σearned / Σmax. */
interface Item {
  key: string;
  max: number;
  earned: number;
  effort: Fix["effort"];
  text: string; // shown only when the item isn't fully earned
}

interface PillarResult {
  score: number; // 0..100, unrounded
  items: Item[];
}

/* ---------- Small formulas ---------- */

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

export function ratingNorm(rating: number | null): number {
  if (rating === null) return 0;
  const { ratingFloor, ratingCeil } = config.reputation;
  return clamp((rating - ratingFloor) / (ratingCeil - ratingFloor));
}

/** Review volume relative to the busiest competitor (log scale). */
export function volumeNorm(reviews: number, maxCompetitorReviews: number | null): number {
  const denominator = Math.log10(1 + (maxCompetitorReviews ?? NO_COMPETITOR_REVIEWS));
  if (denominator === 0) return reviews > 0 ? 1 : 0; // every competitor has zero reviews
  return Math.min(1, Math.log10(1 + reviews) / denominator);
}

export function recency(newestReviewAt: string | null, now = new Date()): number {
  if (!newestReviewAt) return 0;
  const ageDays = (now.getTime() - Date.parse(newestReviewAt)) / DAY_MS;
  const [fresh, recent] = config.reputation.recencyDays;
  if (ageDays <= fresh) return 1;
  if (ageDays <= recent) return 0.5;
  return 0;
}

export function sentimentNorm(positiveRatio: number | null): number {
  return positiveRatio === null ? 0 : clamp((positiveRatio - 0.5) * 2);
}

/** Gemini's positive ratio, else the share of 4–5 star reviews in the snapshot, else null. */
export function positiveRatio(sentiment: SentimentResult | null, reviews: PlaceReview[]): number | null {
  if (sentiment) return sentiment.positiveRatio;
  if (reviews.length === 0) return null;
  return reviews.filter((r) => r.rating >= 4).length / reviews.length;
}

export function gradeFor(total: number): Grade {
  const { A, B, C, D } = config.grades;
  if (total >= A) return "A";
  if (total >= B) return "B";
  if (total >= C) return "C";
  if (total >= D) return "D";
  return "F";
}

function maxCompetitorReviews(competitors: CompetitorsResult | null): number | null {
  if (!competitors || competitors.items.length === 0) return null;
  return Math.max(...competitors.items.map((c) => c.reviewCount));
}

/* ---------- Website state ---------- */

/**
 * "none": no website on the Google profile. "unauditable": a website we may not audit
 * (e.g. a facebook.com page), which the psi job marks skipped. Both zero webTech + onPage.
 */
export type WebsiteState = "ok" | "none" | "unauditable";

export function websiteState(input: Pick<ScoringInput, "websiteUrl" | "progress">): WebsiteState {
  if (!input.websiteUrl) return "none";
  if (input.progress.psi === "skipped") return "unauditable";
  return "ok";
}

/* ---------- Pillars ---------- */

function pillar(items: Item[]): PillarResult {
  const max = items.reduce((s, i) => s + i.max, 0);
  const earned = items.reduce((s, i) => s + i.earned, 0);
  return { score: max === 0 ? 0 : (100 * earned) / max, items };
}

const pass = (ok: boolean, max: number) => (ok ? max : 0);

/** Google profile checklist. `hasWebsite` is left to the website fix (see computeScore). */
export function gbpPillar(gbp: GbpResult | null): PillarResult {
  const c = gbp?.checks;
  const w = config.gbp;
  const photos = c?.photosCount ?? 0;
  return pillar([
    { key: "gbp.hasWebsite", max: w.hasWebsite, earned: pass(!!c?.hasWebsite, w.hasWebsite), effort: 3, text: "No website on your Google profile" },
    { key: "gbp.hasPhone", max: w.hasPhone, earned: pass(!!c?.hasPhone, w.hasPhone), effort: 1, text: "Add a phone number to your Google profile" },
    { key: "gbp.hasHours", max: w.hasHours, earned: pass(!!c?.hasHours, w.hasHours), effort: 1, text: "Add your opening hours to your Google profile" },
    { key: "gbp.hasDescription", max: w.hasDescription, earned: pass(!!c?.hasDescription, w.hasDescription), effort: 1, text: "Add a business description to your Google profile" },
    {
      key: "gbp.photos",
      max: w.photos.max,
      earned: w.photos.max * Math.min(1, photos / w.photos.fullAt),
      effort: 1,
      text: `Add more photos to your Google profile (you have ${photos}; aim for ${w.photos.fullAt}+)`,
    },
    { key: "gbp.isOperational", max: w.isOperational, earned: pass(!!c?.isOperational, w.isOperational), effort: 1, text: "Your Google profile isn't marked as open. Check its status" },
    { key: "gbp.hasPrimaryType", max: w.hasPrimaryType, earned: pass(!!c?.hasPrimaryType, w.hasPrimaryType), effort: 1, text: "Set a primary category on your Google profile" },
  ]);
}

export function reputationPillar(
  input: Pick<ScoringInput, "gbp" | "competitors" | "sentiment" | "reviews" | "now">,
): PillarResult {
  const r = config.reputation;
  const reviews = input.gbp?.reviewCount ?? 0;
  const maxComp = maxCompetitorReviews(input.competitors);
  const rating = ratingNorm(input.gbp?.rating ?? null);
  const volume = volumeNorm(reviews, maxComp);
  const fresh = recency(input.gbp?.newestReviewAt ?? null, input.now);
  const ratio = positiveRatio(input.sentiment, input.reviews);
  const mood = sentimentNorm(ratio);
  const target = maxComp === null ? NO_COMPETITOR_REVIEWS : maxComp;
  return pillar([
    {
      key: "reputation.rating",
      max: 100 * r.ratingWeight,
      earned: 100 * r.ratingWeight * rating,
      effort: 3,
      text: input.gbp?.rating == null ? "Get your first Google reviews" : `Lift your ${input.gbp.rating.toFixed(1)}★ rating: fix what unhappy customers mention and ask happy ones to review you`,
    },
    {
      key: "reputation.volume",
      max: 100 * r.volumeWeight,
      earned: 100 * r.volumeWeight * volume,
      effort: 2,
      text: maxComp === null ? `Get more Google reviews (you have ${reviews})` : `Get more Google reviews (you have ${reviews}; the busiest competitor nearby has ${target})`,
    },
    {
      key: "reputation.recency",
      max: 100 * r.recencyWeight,
      earned: 100 * r.recencyWeight * fresh,
      effort: 1,
      text: input.gbp?.newestReviewAt
        ? "Ask a recent customer for a review: your newest one is over a month old"
        : "Ask a recent customer for a review",
    },
    {
      key: "reputation.sentiment",
      max: 100 * r.sentimentWeight,
      earned: 100 * r.sentimentWeight * mood,
      effort: 3,
      text:
        ratio === null
          ? "Encourage happy customers to say what they liked in their reviews"
          : "Reply to and fix the complaints that come up in your reviews",
    },
  ]);
}

/** Rank by ratingNorm × volumeNorm across self + nearby. Ties go in your favour. Null with no competitors. */
export function competitiveRank(
  gbp: GbpResult | null,
  competitors: CompetitorsResult | null,
): { position: number; of: number } | null {
  if (!competitors || competitors.items.length === 0) return null;
  const maxComp = maxCompetitorReviews(competitors);
  const strength = (rating: number | null, reviews: number) => ratingNorm(rating) * volumeNorm(reviews, maxComp);
  const self = strength(gbp?.rating ?? null, gbp?.reviewCount ?? 0);
  const ahead = competitors.items.filter((c) => strength(c.rating, c.reviewCount) > self).length;
  return { position: ahead + 1, of: competitors.items.length + 1 };
}

export interface RankRow {
  self: boolean;
  placeId: string | null; // null for self
  name: string;
  rating: number | null;
  reviewCount: number;
  distanceM: number | null;
}

/** Self + competitors in rank order (same strength as competitiveRank; self first on ties). */
export function rankTable(selfName: string, gbp: GbpResult | null, competitors: CompetitorsResult | null): RankRow[] {
  const maxComp = maxCompetitorReviews(competitors);
  const strength = (r: { rating: number | null; reviewCount: number }) =>
    ratingNorm(r.rating) * volumeNorm(r.reviewCount, maxComp);
  const rows: RankRow[] = [
    { self: true, placeId: null, name: selfName, rating: gbp?.rating ?? null, reviewCount: gbp?.reviewCount ?? 0, distanceM: 0 },
    ...(competitors?.items ?? []).map((c) => ({
      self: false,
      placeId: c.placeId,
      name: c.name,
      rating: c.rating,
      reviewCount: c.reviewCount,
      distanceM: c.distanceM,
    })),
  ];
  return rows
    .map((row, i) => ({ row, i, s: strength(row) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.row);
}

export function competitiveScore(rank: { position: number; of: number } | null): number {
  if (!rank || rank.of <= 1) return 50;
  return 100 * (1 - (rank.position - 1) / (rank.of - 1));
}

export function competitivePillar(gbp: GbpResult | null, competitors: CompetitorsResult | null): PillarResult {
  const rank = competitiveRank(gbp, competitors);
  return pillar([
    {
      key: "competitive.rank",
      max: 100,
      earned: competitiveScore(rank),
      effort: 3,
      text: rank
        ? `Overtake nearby competitors: you rank #${rank.position} of ${rank.of} on rating and reviews`
        : "Build up your rating and reviews to stand out nearby",
    },
  ]);
}

/** Core Web Vitals: field data when Google has it, else the lab LCP/CLS from the mobile run. */
export function cwvPass(psi: PsiResult | null): boolean {
  const m = psi?.mobile ?? psi?.desktop;
  if (!m) return false;
  if (m.cwvPass !== null) return m.cwvPass;
  return m.cwv.lcpMs !== null && m.cwv.lcpMs <= 2500 && (m.cwv.cls ?? 0) <= 0.1;
}

export function webTechPillar(psi: PsiResult | null, dom: DomAuditResult | null): PillarResult {
  const w = config.webTech;
  const basics = (100 * w.basics) / 3;
  const mobile = psi?.mobile?.performance ?? null;
  const desktop = psi?.desktop?.performance ?? null;
  const https = psi ? psi.https : !!dom?.finalUrl.startsWith("https:");
  const viewport = psi?.mobile?.viewport ?? dom?.viewport ?? false;
  const pct = (x: number | null) => Math.round(100 * (x ?? 0));

  const speed: Item[] = psi
    ? [
        { key: "webTech.mobilePerf", max: 100 * w.psiMobilePerf, earned: 100 * w.psiMobilePerf * (mobile ?? 0), effort: 3, text: `Speed up your website on phones (Google scores it ${pct(mobile)}/100)` },
        { key: "webTech.desktopPerf", max: 100 * w.psiDesktopPerf, earned: 100 * w.psiDesktopPerf * (desktop ?? 0), effort: 2, text: `Speed up your website on computers (Google scores it ${pct(desktop)}/100)` },
      ]
    : [
        // PSI failed (site down, timeout): one fix instead of two "0/100" lines.
        { key: "webTech.unreachable", max: 100 * (w.psiMobilePerf + w.psiDesktopPerf), earned: 0, effort: 2, text: "Google's speed test couldn't load your website. Check it's up and loads quickly" },
      ];
  return pillar([
    ...speed,
    { key: "webTech.https", max: basics, earned: pass(https, basics), effort: 2, text: "Serve your website over HTTPS (secure padlock)" },
    { key: "webTech.viewport", max: basics, earned: pass(viewport, basics), effort: 2, text: "Make your website mobile-friendly (add a viewport tag)" },
    { key: "webTech.cwv", max: basics, earned: pass(cwvPass(psi), basics), effort: 3, text: "Pass Google's Core Web Vitals: make the main content load faster and stop layout shifts" },
  ]);
}

export function onPagePillar(dom: DomAuditResult | null, mode: "local" | "online"): PillarResult {
  const w = config.onPage;
  if (!dom) {
    return pillar([
      { key: "onPage.unreadable", max: 100, earned: 0, effort: 2, text: "We couldn't read your website's homepage. Check it loads and doesn't block search engines" },
    ]);
  }
  const titleLen = dom.title?.trim().length ?? 0;
  const descLen = dom.metaDescription?.trim().length ?? 0;
  const altShare = dom.images.total === 0 ? 1 : 1 - dom.images.missingAlt / dom.images.total;
  const noindex = /noindex/i.test(dom.robotsMeta ?? "");

  const items: Item[] = [
    {
      key: "onPage.title",
      max: w.title,
      earned: pass(titleLen >= 10 && titleLen <= 70, w.title),
      effort: 1,
      text: titleLen === 0 ? "Add a page title to your homepage" : `Rewrite your homepage title to 10–70 characters (it's ${titleLen})`,
    },
    {
      key: "onPage.metaDescription",
      max: w.metaDescription,
      earned: pass(descLen >= 50 && descLen <= 160, w.metaDescription),
      effort: 1,
      text: descLen === 0 ? "Add a meta description to your homepage" : `Rewrite your meta description to 50–160 characters (it's ${descLen})`,
    },
    { key: "onPage.h1", max: w.h1, earned: pass(dom.h1Count > 0, w.h1), effort: 1, text: "Add a main heading (H1) to your homepage" },
    mode === "local"
      ? { key: "onPage.localSchema", max: w.localSchema, earned: pass(dom.hasLocalSchema, w.localSchema), effort: 2, text: "Add LocalBusiness structured data (schema.org) to your homepage" }
      : { key: "onPage.structuredData", max: w.localSchema, earned: pass(dom.jsonLdTypes.length > 0, w.localSchema), effort: 2, text: "Add structured data (schema.org JSON-LD) to your homepage" },
    {
      key: "onPage.altText",
      max: w.altText,
      earned: w.altText * altShare,
      effort: 1,
      text: `Add alt text to your images (${dom.images.missingAlt} of ${dom.images.total} have none)`,
    },
    { key: "onPage.contactLinks", max: w.contactLinks, earned: pass(dom.links.tel + dom.links.whatsapp > 0, w.contactLinks), effort: 1, text: "Add a tap-to-call or WhatsApp link to your homepage" },
    {
      key: "onPage.canonicalAndRobots",
      max: w.canonicalAndRobots,
      earned: pass(!!dom.canonical && !noindex, w.canonicalAndRobots),
      effort: 1,
      text: noindex ? "Your homepage tells Google not to list it (noindex). Remove that tag" : "Add a canonical link tag to your homepage",
    },
  ];
  // Name/address/phone consistency only applies to a Google profile (local mode).
  if (mode === "local") {
    items.splice(4, 0, {
      key: "onPage.napMatch",
      max: w.napMatch,
      earned: w.napMatch * (dom.napMatch?.score ?? 0),
      effort: 1,
      text: "Show the same business name, address and phone on your website as on Google",
    });
  }
  return pillar(items);
}

/* ---------- Total ---------- */

/** Which steps each pillar reads. A pillar is final once all of its steps have ended. */
export const PILLAR_STEPS: Record<Pillar, ProgressStep[]> = {
  gbp: ["gbp"],
  reputation: ["gbp", "competitors", "sentiment"],
  competitive: ["gbp", "competitors"],
  webTech: ["psi", "dom"],
  onPage: ["psi", "dom"],
};

function weightsFor(mode: "local" | "online"): Partial<Record<Pillar, number>> {
  return mode === "online" ? config.online.weights : config.weights;
}

function pillarResults(input: ScoringInput): Partial<Record<Pillar, PillarResult>> {
  const site = input.mode === "online" ? "ok" : websiteState(input);
  const noSite: PillarResult = { score: 0, items: [] };
  const web = {
    webTech: site === "ok" ? webTechPillar(input.psi, input.domAudit) : noSite,
    onPage: site === "ok" ? onPagePillar(input.domAudit, input.mode) : noSite,
  };
  if (input.mode === "online") return web;
  return {
    gbp: gbpPillar(input.gbp),
    reputation: reputationPillar(input),
    competitive: competitivePillar(input.gbp, input.competitors),
    ...web,
  };
}

export function computeScore(input: ScoringInput): ScoreResult {
  const weights = weightsFor(input.mode);
  const results = pillarResults(input);
  const site = input.mode === "online" ? "ok" : websiteState(input);

  let total = 0;
  const pillars: ScoreResult["pillars"] = {};
  const fixes: Fix[] = [];
  for (const [name, result] of Object.entries(results) as [Pillar, PillarResult][]) {
    const weight = weights[name] ?? 0;
    total += (weight * result.score) / 100;
    pillars[name] = Math.round(result.score);

    const max = result.items.reduce((s, i) => s + i.max, 0);
    for (const item of result.items) {
      if (item.key === "gbp.hasWebsite") continue; // folded into the website fix below
      const pointsLost = ((item.max - item.earned) / max) * weight;
      if (pointsLost >= MIN_POINTS_LOST) {
        fixes.push({ key: item.key, pillar: name, text: item.text, effort: item.effort, pointsLost: round1(pointsLost) });
      }
    }
  }
  fixes.sort((a, b) => b.pointsLost / b.effort - a.pointsLost / a.effort);

  if (site !== "ok") {
    // No usable website: this fix leads the list and carries everything a website would earn.
    const gbpWebsiteLoss = site === "none" ? (config.gbp.hasWebsite / 100) * (weights.gbp ?? 0) : 0;
    fixes.unshift({
      key: "website.missing",
      pillar: "webTech",
      text:
        site === "none"
          ? "No website on your Google profile"
          : "Your Google profile links to a page we can't audit (like a social media page). Add your own website",
      effort: 3,
      pointsLost: round1((weights.webTech ?? 0) + (weights.onPage ?? 0) + gbpWebsiteLoss),
    });
  }

  const rounded = Math.round(total);
  return {
    total: rounded,
    grade: gradeFor(rounded),
    pillars,
    rank: input.mode === "local" ? competitiveRank(input.gbp, input.competitors) : null,
    fixes,
  };
}

/** Pillar scores whose steps have all ended, for the live teaser before finalize runs. */
export function partialPillars(input: ScoringInput): Partial<Record<Pillar, number>> {
  const ended = (step: ProgressStep) => ["done", "failed", "skipped"].includes(input.progress[step] ?? "pending");
  const relevant = new Set<ProgressStep>(input.mode === "online" ? ["psi", "dom"] : ["gbp", "competitors", "psi", "dom", "sentiment"]);
  const results = pillarResults(input);
  const out: Partial<Record<Pillar, number>> = {};
  for (const [name, result] of Object.entries(results) as [Pillar, PillarResult][]) {
    if (PILLAR_STEPS[name].filter((s) => relevant.has(s)).every(ended)) out[name] = Math.round(result.score);
  }
  return out;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
