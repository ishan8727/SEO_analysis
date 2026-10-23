import { describe, expect, it } from "vitest";
import {
  competitiveRank,
  competitiveScore,
  computeScore,
  cwvPass,
  gbpPillar,
  gradeFor,
  onPagePillar,
  partialPillars,
  positiveRatio,
  ratingNorm,
  recency,
  reputationPillar,
  sentimentNorm,
  volumeNorm,
  webTechPillar,
  websiteState,
  type ScoringInput,
} from "@/lib/scoring";
import type { CompetitorsResult, DomAuditResult, GbpResult, PsiResult, PsiStrategyResult, SentimentResult } from "@/types";

const NOW = new Date("2026-10-23T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const gbp = (over: Partial<GbpResult> = {}, checks: Partial<GbpResult["checks"]> = {}): GbpResult => ({
  checks: {
    hasWebsite: true,
    hasPhone: true,
    hasHours: true,
    hasDescription: true,
    photosCount: 10,
    isOperational: true,
    hasPrimaryType: true,
    ...checks,
  },
  rating: 5,
  reviewCount: 100,
  newestReviewAt: daysAgo(5),
  ...over,
});

const competitors = (...items: [rating: number | null, reviews: number][]): CompetitorsResult => ({
  radiusM: 3000,
  primaryType: "dentist",
  items: items.map(([rating, reviewCount], i) => ({
    placeId: `comp${i}`,
    name: `Competitor ${i}`,
    rating,
    reviewCount,
    location: null,
    websiteUri: null,
    distanceM: 500,
  })),
});

const strategy = (performance: number, over: Partial<PsiStrategyResult> = {}): PsiStrategyResult => ({
  performance,
  seo: 1,
  bestPractices: 1,
  accessibility: 1,
  cwv: { lcpMs: 1800, cls: 0.02, inpMs: null, fcpMs: 900, tbtMs: 50 },
  cwvPass: true,
  viewport: true,
  failingSeoAudits: [],
  ...over,
});

const psi = (mobile = 1, desktop = 1, over: Partial<PsiResult> = {}): PsiResult => ({
  url: "https://example.in/",
  https: true,
  mobile: strategy(mobile),
  desktop: strategy(desktop),
  ...over,
});

const dom = (over: Partial<DomAuditResult> = {}): DomAuditResult => ({
  renderer: "moli",
  finalUrl: "https://example.in/",
  httpStatus: 200,
  title: "Sharma Dental Care | Dentist in Indiranagar",
  metaDescription: "Family dental clinic in Indiranagar, Bengaluru. Cleanings, implants and braces. Open 7 days.",
  canonical: "https://example.in/",
  robotsMeta: null,
  viewport: true,
  h1Count: 1,
  h2Count: 3,
  jsonLdTypes: ["Dentist"],
  hasLocalSchema: true,
  ogTags: {},
  images: { total: 10, missingAlt: 0 },
  links: { internal: 10, external: 2, tel: 1, whatsapp: 0, maps: 1 },
  keywordHits: { ordering: false, booking: true },
  robotsTxt: true,
  sitemapXml: true,
  napMatch: { name: 1, address: 1, phone: 1, score: 1 },
  ...over,
});

const sentiment = (positiveRatio: number): SentimentResult => ({
  loves: ["friendly staff"],
  complaints: ["waiting time"],
  positiveRatio,
  summary: "Mostly positive.",
  reviewCount: 5,
});

const allDone = { gbp: "done", competitors: "done", psi: "done", dom: "done", sentiment: "done", finalize: "done" } as const;

/** A perfect local business: every check passes, best-rated nearby. */
const perfect = (over: Partial<ScoringInput> = {}): ScoringInput => ({
  mode: "local",
  websiteUrl: "https://example.in/",
  progress: allDone,
  gbp: gbp(),
  competitors: competitors([4.5, 100], [4.0, 50]),
  psi: psi(),
  domAudit: dom(),
  sentiment: sentiment(1),
  reviews: [],
  now: NOW,
  ...over,
});

describe("small formulas", () => {
  it("ratingNorm maps 3.5..5 to 0..1 and clamps", () => {
    expect(ratingNorm(3.5)).toBe(0);
    expect(ratingNorm(4.25)).toBeCloseTo(0.5);
    expect(ratingNorm(5)).toBe(1);
    expect(ratingNorm(2)).toBe(0);
    expect(ratingNorm(null)).toBe(0);
  });

  it("volumeNorm is log-relative to the busiest competitor, capped at 1", () => {
    expect(volumeNorm(99, 99)).toBe(1);
    expect(volumeNorm(9, 99)).toBeCloseTo(0.5);
    expect(volumeNorm(500, 99)).toBe(1);
    expect(volumeNorm(0, 99)).toBe(0);
  });

  it("volumeNorm uses 50 as the denominator without competitors", () => {
    expect(volumeNorm(50, null)).toBe(1);
    expect(volumeNorm(6, null)).toBeCloseTo(Math.log10(7) / Math.log10(51));
  });

  it("volumeNorm handles competitors that all have zero reviews", () => {
    expect(volumeNorm(3, 0)).toBe(1);
    expect(volumeNorm(0, 0)).toBe(0);
  });

  it("recency: 1 within 30 days, 0.5 within 90, else 0", () => {
    expect(recency(daysAgo(30), NOW)).toBe(1);
    expect(recency(daysAgo(31), NOW)).toBe(0.5);
    expect(recency(daysAgo(90), NOW)).toBe(0.5);
    expect(recency(daysAgo(91), NOW)).toBe(0);
    expect(recency(null, NOW)).toBe(0);
  });

  it("sentimentNorm maps positiveRatio 0.5..1 to 0..1", () => {
    expect(sentimentNorm(1)).toBe(1);
    expect(sentimentNorm(0.75)).toBeCloseTo(0.5);
    expect(sentimentNorm(0.3)).toBe(0);
    expect(sentimentNorm(null)).toBe(0);
  });

  it("positiveRatio falls back to the share of 4–5 star reviews, then null", () => {
    expect(positiveRatio(sentiment(0.9), [])).toBe(0.9);
    const reviews = [5, 4, 2, 1].map((rating) => ({ rating, text: null, publishTime: NOW.toISOString() }));
    expect(positiveRatio(null, reviews)).toBe(0.5);
    expect(positiveRatio(null, [])).toBeNull();
  });

  it("grades follow config thresholds", () => {
    expect(gradeFor(85)).toBe("A");
    expect(gradeFor(84)).toBe("B");
    expect(gradeFor(70)).toBe("B");
    expect(gradeFor(55)).toBe("C");
    expect(gradeFor(40)).toBe("D");
    expect(gradeFor(39)).toBe("F");
  });
});

describe("pillars", () => {
  it("gbp: checklist points, photos scale up to 10", () => {
    expect(gbpPillar(gbp()).score).toBe(100);
    expect(gbpPillar(gbp({}, { photosCount: 5 })).score).toBe(90);
    expect(gbpPillar(gbp({}, { hasPhone: false, hasHours: false })).score).toBe(70);
    expect(gbpPillar(null).score).toBe(0);
  });

  it("reputation = 100 × (0.4 rating + 0.35 volume + 0.15 recency + 0.10 sentiment)", () => {
    const r = reputationPillar({
      gbp: gbp({ rating: 4.25, reviewCount: 9, newestReviewAt: daysAgo(60) }),
      competitors: competitors([4, 99]),
      sentiment: sentiment(0.75),
      reviews: [],
      now: NOW,
    });
    expect(r.score).toBeCloseTo(100 * (0.4 * 0.5 + 0.35 * 0.5 + 0.15 * 0.5 + 0.1 * 0.5));
  });

  it("reputation with no reviews scores 0", () => {
    const r = reputationPillar({
      gbp: gbp({ rating: null, reviewCount: 0, newestReviewAt: null }),
      competitors: null,
      sentiment: null,
      reviews: [],
      now: NOW,
    });
    expect(r.score).toBe(0);
  });

  it("competitive: rank by ratingNorm × volumeNorm; ties count in your favour", () => {
    const rank = competitiveRank(gbp({ rating: 4.5, reviewCount: 100 }), competitors([5, 100], [4.5, 100], [3, 500]));
    expect(rank).toEqual({ position: 2, of: 4 });
    expect(competitiveScore(rank)).toBeCloseTo(100 * (1 - 1 / 3));
    expect(competitiveScore({ position: 1, of: 4 })).toBe(100);
    expect(competitiveScore({ position: 4, of: 4 })).toBe(0);
  });

  it("competitive with no competitors is 50 and has no rank", () => {
    expect(competitiveRank(gbp(), null)).toBeNull();
    expect(competitiveRank(gbp(), competitors())).toBeNull();
    expect(competitiveScore(null)).toBe(50);
  });

  it("webTech = 100 × (0.5 mobile + 0.2 desktop + 0.3 × basics/3)", () => {
    expect(webTechPillar(psi(), dom()).score).toBeCloseTo(100);
    const r = webTechPillar(psi(0.4, 0.8, { https: false }), dom());
    expect(r.score).toBeCloseTo(100 * (0.5 * 0.4 + 0.2 * 0.8 + 0.3 * (2 / 3)));
  });

  it("webTech falls back to lab LCP/CLS when there is no field data", () => {
    const lab = (lcpMs: number) => psi(1, 1, { mobile: strategy(1, { cwvPass: null, cwv: { lcpMs, cls: 0.05, inpMs: null, fcpMs: null, tbtMs: null } }) });
    expect(cwvPass(lab(2400))).toBe(true);
    expect(cwvPass(lab(4000))).toBe(false);
    expect(cwvPass(null)).toBe(false);
  });

  it("webTech without PSI keeps https/viewport from the DOM audit and adds one fix", () => {
    const r = webTechPillar(null, dom());
    expect(r.score).toBeCloseTo(20);
    expect(r.items.map((i) => i.key)).toContain("webTech.unreachable");
  });

  it("onPage: checklist points, alt text scales by missing share", () => {
    expect(onPagePillar(dom(), "local").score).toBe(100);
    expect(onPagePillar(dom({ images: { total: 10, missingAlt: 5 } }), "local").score).toBe(95);
    expect(onPagePillar(dom({ title: null, hasLocalSchema: false }), "local").score).toBe(70);
    expect(onPagePillar(dom({ robotsMeta: "noindex, nofollow" }), "local").score).toBe(90);
    expect(onPagePillar(dom({ napMatch: { name: 1, address: 0, phone: 0.5, score: 0.5 } }), "local").score).toBe(90);
    expect(onPagePillar(null, "local").score).toBe(0);
  });

  it("onPage in online mode drops NAP and accepts any structured data", () => {
    const r = onPagePillar(dom({ napMatch: null, hasLocalSchema: false, jsonLdTypes: ["Organization"] }), "online");
    expect(r.score).toBe(100);
    expect(r.items.map((i) => i.key)).not.toContain("onPage.napMatch");
  });
});

describe("computeScore", () => {
  it("a perfect business scores 100, grade A, rank #1, no fixes", () => {
    const s = computeScore(perfect());
    expect(s.total).toBe(100);
    expect(s.grade).toBe("A");
    expect(s.rank).toEqual({ position: 1, of: 3 });
    expect(s.pillars).toEqual({ gbp: 100, reputation: 100, competitive: 100, webTech: 100, onPage: 100 });
    expect(s.fixes).toEqual([]);
  });

  it("total is the weighted sum of pillars", () => {
    const s = computeScore(perfect({ psi: psi(0, 0, { https: false, mobile: strategy(0, { viewport: false }) }) }));
    // webTech: only cwv passes (10/100) → loses 90% of its 20 weight
    expect(s.pillars.webTech).toBe(10);
    expect(s.total).toBe(Math.round(100 - 0.9 * 20));
  });

  it("fixes carry points of the total and are sorted by pointsLost / effort", () => {
    const s = computeScore(perfect({ domAudit: dom({ metaDescription: null, hasLocalSchema: false }) }));
    expect(s.fixes.map((f) => [f.key, f.pointsLost, f.effort])).toEqual([
      // meta: 10/100 × 20 = 2 points, effort 1 → 2; schema: 15/100 × 20 = 3, effort 2 → 1.5
      ["onPage.metaDescription", 2, 1],
      ["onPage.localSchema", 3, 2],
    ]);
  });

  it("no website: webTech = onPage = 0 and the fix list leads with it", () => {
    const s = computeScore(
      perfect({
        websiteUrl: null,
        gbp: gbp({}, { hasWebsite: false, hasPhone: false }),
        progress: { ...allDone, psi: "skipped", dom: "skipped" },
        psi: null,
        domAudit: null,
      }),
    );
    expect(s.pillars.webTech).toBe(0);
    expect(s.pillars.onPage).toBe(0);
    expect(s.fixes[0]).toMatchObject({ key: "website.missing", text: "No website on your Google profile" });
    // 20 (webTech) + 20 (onPage) + 20% of the 25 gbp weight
    expect(s.fixes[0].pointsLost).toBe(45);
    expect(s.fixes.map((f) => f.key)).not.toContain("gbp.hasWebsite");
    expect(s.fixes.map((f) => f.key)).toContain("gbp.hasPhone");
  });

  it("a website we may not audit scores like no website, without the GBP penalty", () => {
    const input = perfect({ progress: { ...allDone, psi: "skipped", dom: "skipped" }, psi: null, domAudit: null });
    expect(websiteState(input)).toBe("unauditable");
    const s = computeScore(input);
    expect(s.pillars.gbp).toBe(100);
    expect(s.fixes[0]).toMatchObject({ key: "website.missing", pointsLost: 40 });
  });

  it("no reviews: reputation 0, review fixes present", () => {
    const s = computeScore(perfect({ gbp: gbp({ rating: null, reviewCount: 0, newestReviewAt: null }), sentiment: null }));
    expect(s.pillars.reputation).toBe(0);
    expect(s.pillars.competitive).toBe(0); // last of 3
    expect(s.fixes.map((f) => f.key)).toEqual(
      expect.arrayContaining(["reputation.rating", "reputation.volume", "reputation.recency", "reputation.sentiment"]),
    );
  });

  it("no competitors: competitive 50, rank null", () => {
    const s = computeScore(perfect({ competitors: null, progress: { ...allDone, competitors: "failed" } }));
    expect(s.pillars.competitive).toBe(50);
    expect(s.rank).toBeNull();
  });

  it("online mode: only webTech and onPage, weighted 50/50, no rank", () => {
    const s = computeScore({
      mode: "online",
      websiteUrl: "https://example.in",
      progress: { psi: "done", dom: "done", finalize: "done" },
      gbp: null,
      competitors: null,
      psi: psi(0.5, 1),
      domAudit: dom({ napMatch: null }),
      sentiment: null,
      reviews: [],
      now: NOW,
    });
    expect(Object.keys(s.pillars).sort()).toEqual(["onPage", "webTech"]);
    expect(s.pillars.webTech).toBe(75);
    expect(s.total).toBe(Math.round(0.5 * 75 + 0.5 * 100));
    expect(s.rank).toBeNull();
    expect(s.fixes[0]).toMatchObject({ key: "webTech.mobilePerf", pointsLost: 12.5 });
  });

  it("failed steps score as missing data", () => {
    const s = computeScore(perfect({ psi: null, domAudit: null, progress: { ...allDone, psi: "failed", dom: "failed" } }));
    expect(s.pillars.onPage).toBe(0);
    expect(s.fixes.map((f) => f.key)).toEqual(expect.arrayContaining(["onPage.unreadable", "webTech.unreachable"]));
  });
});

describe("partialPillars", () => {
  it("only reveals pillars whose steps have ended", () => {
    const input = perfect({
      progress: { gbp: "done", competitors: "running", psi: "running", dom: "done", sentiment: "skipped" },
    });
    expect(partialPillars(input)).toEqual({ gbp: 100 });
  });

  it("online mode ignores the local-only steps", () => {
    const input = perfect({ mode: "online", progress: { psi: "done", dom: "done" } });
    expect(partialPillars(input)).toEqual({ webTech: 100, onPage: 100 });
  });
});
