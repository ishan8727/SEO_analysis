
# SPEC.md — Local SEO Audit & Lead Gen Tool

Source of truth for this repo. Converted from `target/Implmentation DOC.docx`. Corrections found while building Phase 1 are folded in and listed in section 14. Architecture diagram: `target/Architecture.png`.

The browser calls Google Places directly for autocomplete. Everything else goes through the Next.js app, which enqueues a scan; the worker runs it against the free external APIs and our own Moli container.

## 0. How to use this with Claude Code

1. Build one phase at a time, in order. Each phase has a brief in `phases/phase-N.md` with its tasks and acceptance criteria.
2. Prompt: "Read SPEC.md and phases/phase-N.md. Implement Phase N exactly as written, then stop and show me how to verify it."
3. Do not skip ahead. Security rules in section 10 apply to every phase, not just Phase 6.

## 1. Locked decisions and assumptions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, TypeScript strict, Cache Components on), one repo, app + worker share the code | Small project; keep it readable, not micro-modular |
| UI | shadcn/ui (base-ui primitives) + Tailwind v4, minimal, light mode first | Your call |
| DB | Postgres via Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) | Leads + scans need relations and durability |
| Queue | BullMQ on Redis | Scans are async; polling UI needs job state |
| Business lookup | Google Places API (New), browser key for Autocomplete, server key for Details + Nearby Search | See pricing note below |
| Website scores + screenshots | PageSpeed Insights API (mobile + desktop) | Free, 25k/day, returns Lighthouse scores and screenshots |
| Deep DOM audit + PDF | Moli headless browser (Rust, CDP) in our own container behind a Caddy token gate, driven by playwright-core; fallback to fetch + cheerio | ~15 MB idle; fallback covers rendering gaps |
| Competitors | Places Nearby Search | No scraping of Google properties, ever |
| Review sentiment | Gemini Flash-Lite via `@google/genai` (structured JSON output), pinned in `GEMINI_MODEL` | Fractions of a paisa per audit |
| Lead gate | Firebase Phone Auth (SMS code) in the browser; server verifies the Firebase ID token with `firebase-admin`; report unlocks on the page with a PDF download | Works on web; billed per SMS by destination country (~$0.07 India, ~$0.01 US, ~$0.04 UK), first 10/day free (Blaze plan); no Meta setup |
| Map on report | Leaflet + OpenStreetMap tiles | No Google Maps JS billing or key exposure |
| Files (screenshots, PDFs) | `Asset` table in Postgres | Web and worker both need the files; one `pg_dump` backs up everything |
| Hosting | Google Cloud: one Compute Engine VM (`e2-medium`, asia-south1 Mumbai) running the compose stack (web + worker from one image, moli, Postgres, Redis) behind Caddy for HTTPS; images from Cloud Build / Artifact Registry; secrets in Secret Manager; nightly `pg_dump` to Cloud Storage | User decision 2026-10-24 (GCP only, cheapest option); production matches local compose |
| Target market | International: any country (worldwide business search ranked near the visitor by IP; the business's country comes from Google's `addressComponents`), all local business categories via a dropdown; "Online only" mode for non-local | Decided 2026-10-23; `DEFAULT_COUNTRY` is only the phone gate's last-resort default |

**Places pricing note.** Google bills each call at the highest tier of any field in its field mask. The Details mask in Phase 2 includes `websiteUri`, `nationalPhoneNumber`, `rating`, `userRatingCount`, `regularOpeningHours` (Enterprise) and `reviews`, `editorialSummary` (Enterprise + Atmosphere). The Nearby Search mask includes `rating`, `userRatingCount`, `websiteUri` (Enterprise). Free monthly caps for those tiers are lower than the Essentials/Pro caps. Check current pricing before launch and trim fields if needed.

## 2. Stack and external services

- Node 22, pnpm 12, Next.js 16.4, TypeScript strict, Prisma 7.10, BullMQ, ioredis, zod 4, playwright-core, cheerio, libphonenumber-js, firebase (client) + firebase-admin (server), pino, nanoid, `@google/genai`, leaflet/react-leaflet, shadcn/ui, undici + ipaddr.js (SSRF guard), vitest, tsup, tsx.
- Google Cloud project: enable Maps JavaScript API, Places API (New), PageSpeed Insights API. Two keys: `NEXT_PUBLIC_GOOGLE_BROWSER_KEY` (referrer-restricted, Maps JS + Places only) and `GOOGLE_SERVER_KEY` (IP-restricted to Railway egress, Places + PSI). One billing account for Maps, Firebase and Gemini.
- Gemini API key (AI Studio).
- Firebase project (Blaze plan) on the same GCP project: Phone sign-in enabled, SMS region policy = Allow list of the countries we sell to (same list as `NEXT_PUBLIC_PHONE_COUNTRIES`), production domain in Authorized domains (`audit.thesalesinc.com`; `localhost` isn't allowed for phone auth, so the gate is tested live after deploy), test phone numbers, budget alert. Web config (`apiKey`, `authDomain`, `projectId`) is public.
- Cloudflare Turnstile site + secret key.

## 3. Repository structure

```
.
├── SPEC.md                      # this file
├── .claude/CLAUDE.md            # project instructions for Claude Code
├── .claude/settings.json
├── phases/                      # one brief per build phase
├── .env.example
├── Dockerfile                   # one image: web + worker
├── docker-compose.yml           # web, worker, moli, redis, postgres
├── docker-compose.dev.yml       # publishes postgres/redis/moli on 127.0.0.1 for host dev
├── docker/moli/                 # Moli binary + Caddy token gate
├── .github/workflows/ci.yml
├── prisma/schema.prisma, prisma/migrations/
├── prisma.config.ts
├── config/scoring.json
├── config/categories.json       # Phase 2: dropdown → Places primary types
├── scripts/                     # ping.ts, moli-smoke.ts (+ dev scripts per phase)
├── src/
│   ├── types.ts                 # shared data contracts (Json blobs, API payloads)
│   ├── generated/prisma/        # prisma generate output (gitignored)
│   ├── app/
│   │   ├── page.tsx                        # landing + search (Phase 2)
│   │   ├── scan/[id]/page.tsx              # live scan + teaser + gate (Phase 4/5)
│   │   ├── report/[id]/page.tsx            # full report, unlocked (Phase 4)
│   │   ├── report/[id]/print/page.tsx      # PDF-only layout, internal token (Phase 5)
│   │   └── api/
│   │       ├── scans/route.ts                    # POST create (Phase 2)
│   │       ├── scans/[id]/route.ts               # GET status + teaser/report (Phase 4)
│   │       ├── scans/[id]/assets/[kind]/route.ts # GET screenshot/PDF bytes (Phase 4)
│   │       ├── verify/confirm/route.ts           # POST Firebase ID token → unlock cookie (Phase 5)
│   │       └── health/route.ts                   # Phase 1
│   ├── components/              # shadcn ui/ + ScanProgress, ScoreRing, PillarBars, CompetitorMap, Gate
│   ├── lib/
│   │   ├── env.ts               # zod-validated server env, lazy
│   │   ├── db.ts                # prisma client
│   │   ├── redis.ts, queue.ts   # ioredis + BullMQ queue, job names, enqueueScan()
│   │   ├── scan-progress.ts     # atomic Scan.progress updates
│   │   ├── rate-limit.ts        # sliding window on Redis; all limits in one object
│   │   ├── api.ts               # apiError(), getClientIp()
│   │   ├── hash.ts              # hashIdentifier() for IPs/codes, safeEqual()
│   │   ├── unlock.ts            # HMAC-signed unlock cookie
│   │   ├── ssrf.ts              # safe URL + DNS checks, safeFetch()
│   │   ├── browser.ts           # Moli CDP connect, withPage()
│   │   ├── log.ts               # pino with redaction
│   │   ├── turnstile.ts         # Phase 2
│   │   ├── google/places.ts     # Phase 2 details; Phase 3 nearby
│   │   ├── google/psi.ts        # Phase 3
│   │   ├── gemini.ts            # Phase 3
│   │   ├── scoring.ts           # Phase 4: pure functions, reads config/scoring.json
│   │   ├── firebase-admin.ts    # Phase 5: verifyPhoneIdToken()
│   │   ├── crm.ts               # later (CRM deferred)
│   └── worker/
│       ├── index.ts             # BullMQ Worker bootstrap, job routing
│       └── jobs/                # ping, gbp, competitors, psi, dom-audit, sentiment, finalize, pdf, retention
└── tests/                       # vitest: rate-limit, ssrf, unlock (+ scoring, firebase token checks in later phases)
```

## 4. CLAUDE.md

Lives at `.claude/CLAUDE.md` (Claude Code reads it from there). It holds the commands, hard rules, style and per-phase verification steps. Keep it in sync when commands or rules change.

## 5. .claude/settings.json and .env.example

Both are in the repo. `.env.example` lists every variable with comments; copy it to `.env`. Secrets (`HASH_SALT`, `COOKIE_SECRET`, `INTERNAL_TOKEN`, `MOLI_TOKEN`) are random 32-byte values; the command to generate one is in the file. `.env` values must not have inline comments.

## 6. Containers

- **App image** (`Dockerfile`): multi-stage on `node:22-alpine`. Builds Next (`next build`) and the worker bundle (`tsup` → `dist-worker/index.mjs`). The runtime stage ships the full production `node_modules` (not Next standalone), because the worker and `prisma migrate deploy` need packages Next's file tracing leaves out.
  - web: `prisma migrate deploy && next start`
  - worker: `node dist-worker/index.mjs`
- **Moli** (`docker/moli/`): Debian slim + the Moli release binary (pinned `MOLI_VERSION`) + Caddy. There is no official Moli image and Moli has no auth of its own, so Moli listens on `127.0.0.1:9223` and Caddy on `:9222` checks `MOLI_TOKEN` (Bearer header, `?token=` or basic auth) and rewrites `/json/version` so CDP clients get a reachable WebSocket URL. `/health` needs no token. Flags: `--block-private-networks --layout`.
- **Compose**: `docker compose up --build` runs all five services; only web is published. `docker-compose.dev.yml` additionally publishes postgres, redis and moli on `127.0.0.1` for host development. Redis runs with `maxmemory-policy noeviction` (BullMQ requirement). Memory limits are set in `docker-compose.prod.yml` (Docker on the VM honours them), not in the base file.
- **Google Cloud (Phase 6)**: `docker-compose.yml` + `docker-compose.prod.yml` on one Compute Engine VM. The prod file pulls images from Artifact Registry, adds a Caddy service (the only one publishing ports, 80/443, Let's Encrypt), restart policies, memory limits and the `gcplogs` logging driver. Moli, Postgres and Redis stay on the compose network (`MOLI_URL=http://moli:9222`, `INTERNAL_APP_URL=http://web:3000`). Firewall: 80/443 public, SSH through IAP only.

## 7. Data model

`prisma/schema.prisma` is the source of truth: `Business`, `Scan`, `Asset`, `Lead` (`Verification` is dropped in Phase 5; Firebase holds code state). The shapes of `Scan`'s Json columns (`progress`, `placeSnapshot`, `gbp`, `competitors`, `psi`, `domAudit`, `sentiment`, `score`) are defined in `src/types.ts`. Scan ids are `nanoid(21)`. Screenshots and PDFs live in `Asset` (`@@unique([scanId, kind])`), not on disk.

## 8. API contracts

| Route | Body / params | Response | Limits |
|---|---|---|---|
| POST /api/scans | `{ mode: "local", placeId, turnstileToken }` or `{ mode: "online", url, turnstileToken }` | `{ scanId }` (existing id if a scan of the same business is newer than SCAN_CACHE_DAYS) | 5/min/IP, 30/day/IP, 3/day per placeId |
| GET /api/scans/:id | — | `ScanTeaser` while running/locked; `ScanReport` if the request carries a valid unlock cookie for this scan | 60/min/IP |
| GET /api/scans/:id/assets/:kind | kind ∈ screenshot_mobile, screenshot_desktop, pdf | image/PDF bytes; pdf requires the unlock cookie | 120/min/IP |
| POST /api/verify/confirm | `{ scanId, role, idToken }` (Firebase ID token from phone sign-in) | sets httpOnly signed cookie `unlock_<scanId>`; `{ ok: true }`; 401 `VERIFY_FAILED` for a bad, stale (>5 min) or non-phone token; 403 `COUNTRY_NOT_SUPPORTED` | 20/10min/IP, 10/hour/phone |
| GET /api/health | — | `{ db, redis, moli }` each "ok" or "down"; 503 if any is down | none (uptime checks) |

All limits live in `RATE_LIMITS` in `src/lib/rate-limit.ts`. Errors: 429 `{ code: "RATE_LIMITED" }` with Retry-After, 400 `{ code: "INVALID_INPUT" }`, 403 `{ code: "CAPTCHA_FAILED" }`, 404 `{ code: "NOT_FOUND" }`, 500 `{ code: "SCAN_FAILED" }`. Owner-style copy on the client: 429 → "Woah, slow down. Try again in a few minutes."

## 9. Live scan UX contract

The scan page polls GET /api/scans/:id every 2 s (back off to 5 s after 30 s). Progress keys and the UI step they drive: `gbp` → "Reading your Google profile", `competitors` → "Finding nearby competitors", `psi` → "Testing your website speed", `dom` → "Checking on-page SEO", `sentiment` → "Reading your reviews", `finalize` → "Calculating score". Step states: pending, running, done, failed, skipped. Teaser reveals as each finishes: score ring, pillar bars, both screenshots, "You rank #N of M nearby". Locked (blurred, pointer-events: none): competitor names, fix checklist, sentiment detail. Gate card: role select → phone input → "Send code" (Firebase SMS, invisible reCAPTCHA) → 6-digit code → report unlocks in place; "Resend code" after 60 s.

## 10. Security and rate limiting (mandatory, every phase)

- **Rate limiting:** `src/lib/rate-limit.ts`, sliding-window log on Redis keyed by `hashIdentifier(subject)`; per-route limits from section 8; all limits in one config object; Retry-After on 429.
- **Turnstile** on POST /api/scans from Phase 2 onward; verify server-side; fail closed.
- **Input validation:** zod on every route; placeId regex `^[A-Za-z0-9_-]{10,300}$`; phone parsed with libphonenumber-js (country from the gate select) and must be `isValid()`; phones compared as E.164; URL must be http/https, max 2 KB.
- **SSRF guard** (`src/lib/ssrf.ts`): `parsePublicUrl()` rejects non-http(s), non-default ports, credentials, IP literals and denied hosts; a guarded DNS lookup at socket-connect time rejects any non-public address (private, loopback, link-local, metadata, CGNAT, NAT64, IPv4-mapped), which also covers redirects and DNS rebinding; max 5 redirects re-checked per hop; 20 s timeout; 5 MB body cap; `User-Agent: LocalSEOAudit/1.0 (+APP_URL)`. Use `safeFetch()` for the cheerio fallback and robots/sitemap checks, and `assertPublicUrl()` before Moli navigates.
- **Moli:** private network only, `--block-private-networks`, token gate, one CDP connection per job, hard 45 s job timeout, `browser.close()` in finally (`withPage()` does all of this); robots.txt respected for the audit fetch.
- **Secrets:** server-only env, never `NEXT_PUBLIC_`; `serverExternalPackages` in next.config; CI fails if a server secret name appears in `.next/static`.
- **Headers:** (`src/lib/security-headers.ts`, applied in `next.config.ts`) strict CSP (self + maps.googleapis.com + tile.openstreetmap.org + challenges.cloudflare.com; Phase 5 gate adds www.google.com + www.gstatic.com for reCAPTCHA, identitytoolkit.googleapis.com + securetoken.googleapis.com, and the Firebase authDomain), X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, HSTS in prod.
- **Phone verification:** Firebase sends and checks the SMS code. The server trusts only a Firebase ID token verified with `firebase-admin` (`aud` = project id, `sign_in_provider = phone`, `auth_time` ≤ 5 min old) and re-checks the number with libphonenumber-js (valid, country in `PHONE_COUNTRIES`). Firebase SMS region policy is an allow list of target countries; budget alert on the billing account.
- **Report access:** scan ids are 21-char nanoid; unlock cookie is HMAC-signed `{scanId, leadId, exp}` (7 days), httpOnly, SameSite=Lax (`src/lib/unlock.ts`).
- **Queue hygiene:** BullMQ attempts: 2, exponential backoff, removeOnComplete: 500; per-job timeouts inside handlers (BullMQ has no job timeout); failed scans set status=failed with a user-safe message.
- **Data retention:** nightly repeatable job nulls `placeSnapshot` where `snapshotPurgeAt < now`; deletes screenshot assets older than 90 days; keeps scores, audits, leads.
- **Logging:** pino, redact phone, code, token, idToken, authorization, cookie; hash IPs; no Google review text in logs.
- **Abuse:** reject scans when the URL host is denied (google.com, facebook.com, localhost, internal hosts); per-placeId daily cap prevents a competitor from hammering one business.

## 11. Scoring (config/scoring.json + src/lib/scoring.ts)

`config/scoring.json` is in the repo. Formulas (implement as pure functions with unit tests):

- ratingNorm = clamp((rating − 3.5) / 1.5, 0, 1)
- volumeNorm = min(1, log10(1 + reviews) / log10(1 + maxCompetitorReviews)); if no competitors, denominator = log10(1 + 50)
- recency = 1 if newest review ≤ 30 d, 0.5 if ≤ 90 d, else 0
- sentiment = clamp((positiveRatio − 0.5) × 2, 0, 1) from Gemini output
- reputation = 100 × (0.4·ratingNorm + 0.35·volumeNorm + 0.15·recency + 0.10·sentiment)
- competitive = 100 × (1 − (rank − 1) / (n − 1)), rank by ratingNorm × volumeNorm across self + nearby; n ≤ 1 → 50
- webTech = 100 × (0.5·psiMobile + 0.2·psiDesktop + 0.3·(https + viewport + cwvPass)/3)
- gbp and onPage: sum of checklist points, each item 0/1 except photos = min(1, count/10) and altText = 1 − missingAlt/totalImgs
- total = Σ weight_i × pillar_i / 100; website missing → webTech = onPage = 0 and the fix list leads with "No website on your Google profile"
- Online mode uses `online.weights` (webTech 50, onPage 50).
- Fixes: each failed checklist item has `{ pointsLost, effort: 1|2|3, text }`; sort by pointsLost / effort; show top 5 (3 locked in teaser).

## 12. Build phases

One brief per phase in `phases/`: tasks, files, acceptance criteria and the prompt.

1. Setup and infrastructure (`phases/phase-1.md`) — done
2. Intake (`phases/phase-2.md`)
3. Audit engine (`phases/phase-3.md`)
4. Scoring, report, live scan page (`phases/phase-4.md`)
5. International pass, lead gate (Firebase phone auth), PDF (`phases/phase-5.md`)
6. Hardening, tests, deploy (`phases/phase-6.md`)

## 13. Open items (defaults used until confirmed)

| Item | Default in use | Where |
|---|---|---|
| Countries | International (decided 2026-10-23); no country picker on search, country taken from the place | `PlaceSnapshot.countryCode` |
| SMS countries | Allow list to choose (must match the Firebase SMS region policy) | `NEXT_PUBLIC_PHONE_COUNTRIES` |
| The ~25 categories in the dropdown | 25 + "Something else" | `config/categories.json` |
| "Online only" mode in v1 | Ships, behind a switch | `ONLINE_MODE=on\|off` |
| Phone verification | Firebase Phone Auth, SMS (decided 2026-10-23) | `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID` |
| CRM for leads | Deferred (user, 2026-10-23); leads kept in Postgres with `crmSyncedAt` null for a later push | `src/lib/crm.ts` (later) |

## 14. Changes from the original document (Phase 1)

| Original | Now | Reason |
|---|---|---|
| `ghcr.io/lexmount/moli:latest` with `--token` | Own image in `docker/moli/` (release binary + Caddy gate) | No public Moli image exists (ghcr returns 403) and `moli serve` has no auth flag; confirmed against `moli serve --help` (v1.1.19) |
| `@google/generative-ai` | `@google/genai` | The old SDK is deprecated |
| Next standalone output, worker copied alongside | Full production `node_modules` in the runtime image, `next start` | The worker and `prisma migrate deploy` need packages standalone tracing drops |
| Prisma `url` in schema, client in node_modules | `prisma.config.ts` + driver adapter, client generated to `src/generated/prisma` | Prisma 7 conventions |
| `Scan.screenshots`, `Scan.pdfPath`, `/data` volume | `Asset` table | A Railway volume can only be mounted on one service |
| Redis `allkeys-lru` | `noeviction` | BullMQ breaks if queue keys are evicted |
| Memory limits in compose | Set in `docker-compose.prod.yml` only | Rootless Podman on WSL rejects cgroup limits; Docker on the GCP VM honours them |
| sha256(ip + salt), sha256(code + salt) | HMAC-SHA256 keyed with `HASH_SALT` | Same purpose, the correct primitive |
| `CLAUDE.md` at repo root | `.claude/CLAUDE.md` | The repo root has a leftover empty `CLAUDE.md/` folder; delete it and the file can move to the root |
| `pnpm ping` | `pnpm queue:ping` | pnpm has a built-in `ping` command that shadows the script |
| `TURNSTILE_SITE_KEY` | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Phase 2) | The client reads it; `NEXT_PUBLIC_*` and `ONLINE_MODE` are Docker build args because the landing page is prerendered (`DEFAULT_COUNTRY` was one until the Phase 5 international pass) |
| Gemini Flash (`gemini-flash-latest`) | `gemini-3.5-flash-lite`, pinned (Phase 3) | Full Flash timed out (>60 s) or returned 503 in testing; Flash-Lite answers in 1–2 s and is cheaper. The 2.5 models are closed to new keys |
| `"env": { "NODE_ENV": "development" }` in .claude/settings.json | Removed | It applied to every command, including `next build` |
| — | `"type": "module"` in package.json | tsx scripts use top-level await and the Prisma client uses `import.meta` |
| — | Shared contracts in `src/types.ts`; scan flow wired in `enqueueScan()` with placeholder jobs that mark their step `skipped` | Later phases replace job bodies without touching the flow |
| — | `src/lib/{env,api,hash,unlock,ssrf,scan-progress}.ts` built in Phase 1 | Section 10 rules apply from Phase 1; later phases import them |
| WhatsApp click-to-chat gate + OTP template, `/api/verify/start`, WhatsApp webhook, report sent over WhatsApp (Phase 5) | Firebase Phone Auth in the browser, ID token verified by `/api/verify/confirm`; report unlocks on the page with a PDF download; `Verification` model dropped | User decision 2026-10-23. Firebase works on web; no Meta business number, templates or webhook; Meta started charging for service and in-window utility messages on 2026-10-01 |
| India first, `includedRegionCodes: [DEFAULT_COUNTRY]`, `regionCode` on Places calls, last-10-digit phone match, India-only ordering/booking hosts | International: worldwide search (IP-biased, no picker), country from Place Details `addressComponents`, no fixed `regionCode`, E.164 phone match via libphonenumber-js, global host lists (Phase 5 task 0) | User decision 2026-10-23: the service is for international clients |
| CSP with per-request nonces via `proxy.ts` (Phase 6 brief) | Allowlist CSP set in `next.config.ts` `headers()`, `'unsafe-inline'` scripts, no nonces | Nonces force every page to render per request and don't work with Cache Components / Partial Prerendering (Next 16 CSP guide). Protection comes from the host allowlists, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'` (Phase 6, 2026-10-24) |
| PDF: Moli opens `/report/[id]/print` | Worker fetches the print page over the private network (`INTERNAL_APP_URL`), inlines CSS and fonts, and calls Moli `setContent()` + `pdf()`; homepage screenshots left out of the PDF | Moli runs with `--block-private-networks`, and it doesn't paint raster images (Phase 5 testing) |
| Railway (web, worker, moli, Railway Postgres + Redis) | One Compute Engine VM in asia-south1 running compose + Caddy; Cloud Build, Artifact Registry, Secret Manager, Cloud Logging, `pg_dump` to Cloud Storage | User decision 2026-10-24: host on GCP only, as one VM rather than Cloud Run (cost) |
