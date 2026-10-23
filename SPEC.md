
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
| Lead gate | WhatsApp click-to-chat (user-initiated, free) with OTP-template fallback; provider interface so Meta Cloud API or Interakt can be swapped | Free path first |
| Map on report | Leaflet + OpenStreetMap tiles | No Google Maps JS billing or key exposure |
| Files (screenshots, PDFs) | `Asset` table in Postgres | A Railway volume mounts on one service only; web and worker both need the files |
| Hosting | Railway, one project: web + worker (same image, different start commands), moli, Railway Redis + Postgres | Cheapest managed option; local dev identical via compose |
| Target market (assumed) | India first, all local business categories via a dropdown; "Online only" mode for non-local | Confirm in section 13 |

**Places pricing note.** Google bills each call at the highest tier of any field in its field mask. The Details mask in Phase 2 includes `websiteUri`, `nationalPhoneNumber`, `rating`, `userRatingCount`, `regularOpeningHours` (Enterprise) and `reviews`, `editorialSummary` (Enterprise + Atmosphere). The Nearby Search mask includes `rating`, `userRatingCount`, `websiteUri` (Enterprise). Free monthly caps for those tiers are lower than the Essentials/Pro caps. Check current India pricing before launch and trim fields if needed.

## 2. Stack and external services

- Node 22, pnpm 12, Next.js 16.4, TypeScript strict, Prisma 7.10, BullMQ, ioredis, zod 4, playwright-core, cheerio, libphonenumber-js, pino, nanoid, `@google/genai`, leaflet/react-leaflet, shadcn/ui, undici + ipaddr.js (SSRF guard), vitest, tsup, tsx.
- Google Cloud project: enable Maps JavaScript API, Places API (New), PageSpeed Insights API. Two keys: `NEXT_PUBLIC_GOOGLE_BROWSER_KEY` (referrer-restricted, Maps JS + Places only) and `GOOGLE_SERVER_KEY` (IP-restricted to Railway egress, Places + PSI). Billing account set to India.
- Gemini API key (AI Studio).
- WhatsApp: Meta Cloud API app with a phone number, webhook verify token, and one approved authentication template (fallback OTP). Or Interakt credentials; both behind the same interface.
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
│   │       ├── verify/start/route.ts             # POST phone + role → code (Phase 5)
│   │       ├── verify/confirm/route.ts           # POST OTP (Phase 5)
│   │       ├── webhooks/whatsapp/route.ts        # GET verify, POST inbound (Phase 5)
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
│   │   ├── otp.ts               # Phase 5
│   │   ├── crm.ts               # Phase 5
│   │   └── whatsapp/{index,meta,interakt}.ts  # Phase 5
│   └── worker/
│       ├── index.ts             # BullMQ Worker bootstrap, job routing
│       └── jobs/                # ping, gbp, competitors, psi, dom-audit, sentiment, finalize, pdf, retention
└── tests/                       # vitest: rate-limit, ssrf, unlock (+ scoring, otp in later phases)
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
- **Compose**: `docker compose up --build` runs all five services; only web is published. `docker-compose.dev.yml` additionally publishes postgres, redis and moli on `127.0.0.1` for host development. Redis runs with `maxmemory-policy noeviction` (BullMQ requirement). Memory limits are set per service on Railway, not in compose.
- **Railway**: web and worker from the same Dockerfile with different start commands; moli from `docker/moli/Dockerfile` (private network only, `MOLI_URL=http://moli.railway.internal:9222`); Redis and Postgres as Railway plugins.

## 7. Data model

`prisma/schema.prisma` is the source of truth: `Business`, `Scan`, `Asset`, `Lead`, `Verification`. The shapes of `Scan`'s Json columns (`progress`, `placeSnapshot`, `gbp`, `competitors`, `psi`, `domAudit`, `sentiment`, `score`) are defined in `src/types.ts`. Scan ids are `nanoid(21)`. Screenshots and PDFs live in `Asset` (`@@unique([scanId, kind])`), not on disk.

## 8. API contracts

| Route | Body / params | Response | Limits |
|---|---|---|---|
| POST /api/scans | `{ mode: "local", placeId, turnstileToken }` or `{ mode: "online", url, turnstileToken }` | `{ scanId }` (existing id if a scan of the same business is newer than SCAN_CACHE_DAYS) | 5/min/IP, 30/day/IP, 3/day per placeId |
| GET /api/scans/:id | — | `ScanTeaser` while running/locked; `ScanReport` if the request carries a valid unlock cookie for this scan | 60/min/IP |
| GET /api/scans/:id/assets/:kind | kind ∈ screenshot_mobile, screenshot_desktop, pdf | image/PDF bytes; pdf requires the unlock cookie | 120/min/IP |
| POST /api/verify/start | `{ scanId, phone, role }` | `{ method: "wa_inbound", waLink, code }` or `{ method: "wa_otp" }` | 3/10min/IP, 5/hour/phone |
| POST /api/verify/confirm | `{ scanId, phone, code }` | sets httpOnly signed cookie `unlock_<scanId>`; `{ ok: true }` | 5 attempts per verification, then locked 15 min; 20/10min/IP |
| GET/POST /api/webhooks/whatsapp | Meta verify handshake / inbound messages | 200 | signature check with WHATSAPP_APP_SECRET |
| GET /api/health | — | `{ db, redis, moli }` each "ok" or "down"; 503 if any is down | none (Railway health checks) |

All limits live in `RATE_LIMITS` in `src/lib/rate-limit.ts`. Errors: 429 `{ code: "RATE_LIMITED" }` with Retry-After, 400 `{ code: "INVALID_INPUT" }`, 403 `{ code: "CAPTCHA_FAILED" }`, 404 `{ code: "NOT_FOUND" }`, 500 `{ code: "SCAN_FAILED" }`. Owner-style copy on the client: 429 → "Woah, slow down. Try again in a few minutes."

## 9. Live scan UX contract

The scan page polls GET /api/scans/:id every 2 s (back off to 5 s after 30 s). Progress keys and the UI step they drive: `gbp` → "Reading your Google profile", `competitors` → "Finding nearby competitors", `psi` → "Testing your website speed", `dom` → "Checking on-page SEO", `sentiment` → "Reading your reviews", `finalize` → "Calculating score". Step states: pending, running, done, failed, skipped. Teaser reveals as each finishes: score ring, pillar bars, both screenshots, "You rank #N of M nearby". Locked (blurred, pointer-events: none): competitor names, fix checklist, sentiment detail. Gate card: role select → phone input → "Verify on WhatsApp" button (opens `wa.me/<number>?text=AUDIT <code>`) + "Send me a code instead" link.

## 10. Security and rate limiting (mandatory, every phase)

- **Rate limiting:** `src/lib/rate-limit.ts`, sliding-window log on Redis keyed by `hashIdentifier(subject)`; per-route limits from section 8; all limits in one config object; Retry-After on 429.
- **Turnstile** on POST /api/scans from Phase 2 onward; verify server-side; fail closed.
- **Input validation:** zod on every route; placeId regex `^[A-Za-z0-9_-]{10,300}$`; phone parsed with libphonenumber-js and must be `isValid()`; URL must be http/https, max 2 KB.
- **SSRF guard** (`src/lib/ssrf.ts`): `parsePublicUrl()` rejects non-http(s), non-default ports, credentials, IP literals and denied hosts; a guarded DNS lookup at socket-connect time rejects any non-public address (private, loopback, link-local, metadata, CGNAT, NAT64, IPv4-mapped), which also covers redirects and DNS rebinding; max 5 redirects re-checked per hop; 20 s timeout; 5 MB body cap; `User-Agent: LocalSEOAudit/1.0 (+APP_URL)`. Use `safeFetch()` for the cheerio fallback and robots/sitemap checks, and `assertPublicUrl()` before Moli navigates.
- **Moli:** private network only, `--block-private-networks`, token gate, one CDP connection per job, hard 45 s job timeout, `browser.close()` in finally (`withPage()` does all of this); robots.txt respected for the audit fetch.
- **Secrets:** server-only env, never `NEXT_PUBLIC_`; `serverExternalPackages` in next.config; CI fails if a server secret name appears in `.next/static`.
- **Headers:** strict CSP (self + maps.googleapis.com + tile.openstreetmap.org + challenges.cloudflare.com), X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, HSTS in prod.
- **OTP:** 6 digits, `crypto.randomInt`, hashed, 10 min expiry, 5 attempts, 60 s resend cooldown, constant-time compare. Inbound codes: 8-char uppercase nanoid, single-use, 30 min expiry.
- **Report access:** scan ids are 21-char nanoid; unlock cookie is HMAC-signed `{scanId, leadId, exp}` (7 days), httpOnly, SameSite=Lax (`src/lib/unlock.ts`).
- **Webhook:** verify X-Hub-Signature-256; idempotent on message id (Redis set, 24 h TTL).
- **Queue hygiene:** BullMQ attempts: 2, exponential backoff, removeOnComplete: 500; per-job timeouts inside handlers (BullMQ has no job timeout); failed scans set status=failed with a user-safe message.
- **Data retention:** nightly repeatable job nulls `placeSnapshot` where `snapshotPurgeAt < now`; deletes screenshot assets older than 90 days; keeps scores, audits, leads.
- **Logging:** pino, redact phone, code, token, authorization, cookie; hash IPs; no Google review text in logs.
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
5. Lead gate, WhatsApp, PDF, CRM (`phases/phase-5.md`)
6. Hardening, tests, deploy (`phases/phase-6.md`)

## 13. Open items (defaults used until confirmed)

| Item | Default in use | Where |
|---|---|---|
| Country list for `includedRegionCodes` | India only | `DEFAULT_COUNTRY=IN` |
| The ~25 categories in the dropdown | 25 + "Something else" | `config/categories.json` |
| "Online only" mode in v1 | Ships, behind a switch | `ONLINE_MODE=on\|off` |
| WhatsApp provider | Meta Cloud API (needed by Phase 5) | `WHATSAPP_PROVIDER` |
| CRM for leads | Zoho Bigin (needed by Phase 5) | `src/lib/crm.ts` |

## 14. Changes from the original document (Phase 1)

| Original | Now | Reason |
|---|---|---|
| `ghcr.io/lexmount/moli:latest` with `--token` | Own image in `docker/moli/` (release binary + Caddy gate) | No public Moli image exists (ghcr returns 403) and `moli serve` has no auth flag; confirmed against `moli serve --help` (v1.1.19) |
| `@google/generative-ai` | `@google/genai` | The old SDK is deprecated |
| Next standalone output, worker copied alongside | Full production `node_modules` in the runtime image, `next start` | The worker and `prisma migrate deploy` need packages standalone tracing drops |
| Prisma `url` in schema, client in node_modules | `prisma.config.ts` + driver adapter, client generated to `src/generated/prisma` | Prisma 7 conventions |
| `Scan.screenshots`, `Scan.pdfPath`, `/data` volume | `Asset` table | A Railway volume can only be mounted on one service |
| Redis `allkeys-lru` | `noeviction` | BullMQ breaks if queue keys are evicted |
| Memory limits in compose | Set per service on Railway | Rootless Podman on WSL rejects cgroup limits; Railway ignores compose limits anyway |
| sha256(ip + salt), sha256(code + salt) | HMAC-SHA256 keyed with `HASH_SALT` | Same purpose, the correct primitive |
| `CLAUDE.md` at repo root | `.claude/CLAUDE.md` | The repo root has a leftover empty `CLAUDE.md/` folder; delete it and the file can move to the root |
| `pnpm ping` | `pnpm queue:ping` | pnpm has a built-in `ping` command that shadows the script |
| `TURNSTILE_SITE_KEY` | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Phase 2) | The client reads it; `NEXT_PUBLIC_*`, `DEFAULT_COUNTRY` and `ONLINE_MODE` are Docker build args because the landing page is prerendered |
| Gemini Flash (`gemini-flash-latest`) | `gemini-3.5-flash-lite`, pinned (Phase 3) | Full Flash timed out (>60 s) or returned 503 in testing; Flash-Lite answers in 1–2 s and is cheaper. The 2.5 models are closed to new keys |
| `"env": { "NODE_ENV": "development" }` in .claude/settings.json | Removed | It applied to every command, including `next build` |
| — | `"type": "module"` in package.json | tsx scripts use top-level await and the Prisma client uses `import.meta` |
| — | Shared contracts in `src/types.ts`; scan flow wired in `enqueueScan()` with placeholder jobs that mark their step `skipped` | Later phases replace job bodies without touching the flow |
| — | `src/lib/{env,api,hash,unlock,ssrf,scan-progress}.ts` built in Phase 1 | Section 10 rules apply from Phase 1; later phases import them |
