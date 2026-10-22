# Phase 2 — Intake

**Goal:** a visitor picks their business (or enters a URL in Online mode), and we create a scan and send them to `/scan/[id]`.

**Before starting:** answer SPEC.md section 13 (countries, categories, Online-only flag). Fold the answers into SPEC.md.

## Builds on Phase 1

`env()`, `enforceRateLimits()` + `RATE_LIMITS`, `apiError()`, `getClientIp()`, `hashIdentifier()`, `parsePublicUrl()`, `enqueueScan()`, `PlaceSnapshot` in `src/types.ts`.

## Tasks

1. **`config/categories.json`**: ≈25 categories → Places primary types, e.g. `{ "id": "dentist", "label": "Dentist", "primaryTypes": ["dentist", "dental_clinic"] }`.
2. **Landing page** (`src/app/page.tsx`): mode toggle (Local / Online only), category select, search.
3. **`PlacesSearch` client component**: Maps JS SDK `importLibrary("places")`, `AutocompleteSuggestion.fetchAutocompleteSuggestions`, `AutocompleteSessionToken` (one per search session), 200 ms debounce, stale-reply counter, `includedRegionCodes: [DEFAULT_COUNTRY]` (pass it from the server component as a prop), `includedPrimaryTypes` from the category. On pick: `toPlace().fetchFields({ fields: ["id","displayName","formattedAddress","location","types"] })`. Only ever use `NEXT_PUBLIC_GOOGLE_BROWSER_KEY`.
4. **Turnstile**: client widget (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) + `src/lib/turnstile.ts` server verify (fail closed, pass the client IP).
5. **`src/lib/google/places.ts`** → `getPlaceDetails(placeId): Promise<PlaceSnapshot>`: Places API (New) `GET https://places.googleapis.com/v1/places/{placeId}` with `X-Goog-Api-Key: GOOGLE_SERVER_KEY` and `X-Goog-FieldMask: id,displayName,formattedAddress,location,websiteUri,nationalPhoneNumber,rating,userRatingCount,reviews,regularOpeningHours,photos,businessStatus,primaryType,editorialSummary,googleMapsUri`. Map to `PlaceSnapshot`: count photos and keep no photo data; for reviews keep only rating, text and publishTime. See the pricing note in SPEC.md section 1.
6. **`POST /api/scans`** (`src/app/api/scans/route.ts`):
   - zod discriminated union on `mode`; placeId regex `^[A-Za-z0-9_-]{10,300}$`; URL ≤ 2 KB through `parsePublicUrl()`.
   - Rate limits: `scanCreateIpMinute` + `scanCreateIpDay` on the IP; `scanCreatePlaceDay` on the placeId (local).
   - Turnstile verify → 403 `CAPTCHA_FAILED`.
   - Dedupe: if the business has a scan newer than `SCAN_CACHE_DAYS` that hasn't failed, return its id.
   - Local: `getPlaceDetails` → upsert `Business` by placeId → create `Scan { id: nanoid(21), ipHash: hashIdentifier(ip), placeSnapshot }`. Online: find or create `Business` by normalised website origin.
   - `enqueueScan(scan.id, mode)` → `{ scanId }`.
7. **Redirect** to `/scan/[id]`. Phase 4 builds that page; add a minimal placeholder that shows the scan status, so the redirect lands somewhere.

## Acceptance criteria

- Typing shows suggestions; picking creates a scan and redirects.
- A second pick of the same place within 7 days returns the same id.
- Invalid placeId → 400; 6th request in a minute → 429; Turnstile failure → 403.
- No server key in the client bundle (`grep` `.next/static` for the key value).

## Notes

- Next 16 Cache Components: pages that read request data need `<Suspense>` boundaries; read `node_modules/next/dist/docs/01-app/01-getting-started/` before writing pages.
- With the placeholder jobs the scan finishes instantly as `done` with every step `skipped`. That's expected until Phase 3.

**Prompt:** "Implement Phase 2 of SPEC.md from phases/phase-2.md. The browser must only ever use NEXT_PUBLIC_GOOGLE_BROWSER_KEY."
