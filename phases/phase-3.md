# Phase 3 — Audit engine

**Goal:** a real scan fills `gbp`, `competitors`, `psi`, `domAudit` and `sentiment` within 60 s, and survives Moli going down.

## Builds on

- Phase 1: the flow is already wired (`enqueueScan` → steps in parallel → `finalize`). Replace the placeholder bodies in `src/worker/jobs/`; keep job names and ids. Use `setStepState()` for progress, `withPage()` for Moli, `safeFetch()`/`assertPublicUrl()` for user URLs. Blob shapes are in `src/types.ts`.
- Phase 2: `Scan.placeSnapshot` (local mode) and `Business.websiteUrl`.

## Job pattern

`setStepState(step, "running")` → do the work with a timeout → write the blob → `setStepState(step, "done")`. Throw on errors so BullMQ retries. In `src/worker/index.ts`, when an audit step fails its final attempt, set that step to `failed` (the flow still reaches `finalize`). With no website, `psi` and `dom` mark themselves `skipped` and leave their blobs null.

## Tasks

1. **`gbp.ts`**: `GbpResult` from `placeSnapshot`: checklist, rating, review count, newest review date.
2. **`competitors.ts`** + `searchNearby()` in `src/lib/google/places.ts`: `POST https://places.googleapis.com/v1/places:searchNearby` with `includedPrimaryTypes: [primaryType]`, circle radius 3000 m at the business location, `rankPreference: "POPULARITY"`, `maxResultCount: 10`, field mask `places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.websiteUri`. Exclude self by place id; compute `distanceM`.
3. **`psi.ts`** + `src/lib/google/psi.ts`: mobile and desktop in parallel, `category=performance,seo,best-practices,accessibility`. Extract category scores, CWV (lab + field), `viewport` audit, failing SEO audits. Save `final-screenshot` (base64 JPEG) to `Asset` as `screenshot_mobile` / `screenshot_desktop`, mime `image/jpeg` (converting to webp would need sharp). PSI can take 20–60 s; give each call its own timeout.
4. **`dom-audit.ts`**: `assertPublicUrl()` → check robots.txt (respect a Disallow for our UA or `*`) → `withPage()`: `page.goto` (domcontentloaded), `page.evaluate` for title, meta description, canonical, robots meta, viewport, H1/H2 counts, JSON-LD `@type`s (LocalBusiness or a subtype → `hasLocalSchema`), OG tags, images total/missing alt, internal/external links, `tel:`/`wa.me`/maps links, ordering/booking keywords. robots.txt and sitemap.xml checks via `safeFetch`. NAP match (local mode only): token overlap between page text and the Places name, address and phone (normalised digits). On any Moli error, fall back to `safeFetch` + cheerio with `renderer: "fallback"`.
5. **`sentiment.ts`** + `src/lib/gemini.ts`: `@google/genai` `models.generateContent` with `responseMimeType: "application/json"` and a schema `{ loves: string[], complaints: string[], positiveRatio: number, summary: string }`; 30-day Redis cache keyed `sentiment:<placeId>`; no reviews → `skipped`. Never log review text.
6. **Fixtures + tests** in `tests/fixtures/`: a Places details response, a PSI response, two HTML pages. Unit-test the pure extractors (gbp mapping, PSI parsing, cheerio extraction, NAP match).
7. **`scripts/run-scan.ts <placeId|url>`**: creates a scan, waits, prints every blob.

## Acceptance criteria

- A real scan completes in < 60 s with all five blobs populated.
- Killing Moli mid-scan still produces a report via the fallback.
- A place without a website yields null `psi`/`domAudit` (scored 0 in Phase 4) and the scan completes.
- Nearby Search never returns the business itself.

**Prompt:** "Implement Phase 3 of SPEC.md from phases/phase-3.md job by job. After each job, run it against the fixtures in tests/fixtures and show me the stored JSON."
