# Project: Local SEO Audit & Lead Gen

Single Next.js 16 (App Router, TS strict, Cache Components) repo. One Docker image runs two
processes: the web app (`next start`) and the BullMQ worker (`node dist-worker/index.mjs`).
Start every session by reading TODO.md (progress, what is left, environment gotchas).
Read SPEC.md before any task; it is the source of truth. Build phases in order from
`phases/phase-N.md` and stop at each phase's acceptance criteria.

Next.js 16 differs from older versions (Cache Components, `proxy.ts` instead of middleware,
async params/cookies). Read the relevant guide in `node_modules/next/dist/docs/` before
writing Next code. See AGENTS.md.

## Commands
- pnpm dev                 # next dev
- pnpm worker:dev          # tsx watch src/worker/index.ts
- pnpm build / pnpm build:worker / pnpm start / pnpm worker
- pnpm prisma migrate dev / pnpm prisma generate   # generate after every schema change
- pnpm test                # vitest; needs Redis (rate-limit tests use DB 15)
- pnpm lint && pnpm typecheck
- pnpm queue:ping          # enqueue a ping job and wait for the worker
- pnpm moli:smoke [url]    # drive Moli over CDP: DOM, screenshot, PDF
- pnpm pdf:smoke           # Moli prints HTML passed with setContent() (how the PDF job works)
- pnpm scan:run <placeId|place-details.json|url>   # dev: create a scan (no Turnstile), wait, print blobs; needs the worker
- pnpm seed:demo [--live|--online]   # dev: insert a demo scan (no keys/worker); prints scan URL + unlock cookie
- docker compose up --build                                     # full stack (Podman: `podman compose`)
- docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis moli
                           # backing services on 127.0.0.1 for host dev

## Hard rules
- Never call Google Places, PSI or Gemini from client code except
  Places Autocomplete via the Maps JS SDK with the browser key, and Firebase Phone Auth in the gate
  (src/lib/firebase-client.ts, loaded only by Gate.tsx).
- GOOGLE_SERVER_KEY, GEMINI_API_KEY, TURNSTILE_SECRET, DATABASE_URL,
  REDIS_URL, MOLI_TOKEN, HASH_SALT, COOKIE_SECRET, INTERNAL_TOKEN are server-only.
  Never prefix them NEXT_PUBLIC_. Read them through `env()` in src/lib/env.ts.
- Every API route: zod-validate input, rate-limit (`enforceRateLimits` in src/lib/rate-limit.ts,
  limits only in RATE_LIMITS), return typed JSON errors via `apiError()` ({ error, code }).
- Every outbound fetch to a user-supplied URL goes through src/lib/ssrf.ts (`safeFetch`,
  `assertPublicUrl` before Moli navigates). Moli is used only through `withPage()` in src/lib/browser.ts.
- Never scrape google.com / maps. Competitors come from Nearby Search only.
- Phone numbers stored E.164; trust a phone number only from a Firebase ID token verified server-side; never log raw phone, code or ID token.
- Google place data (rating, reviews, hours) is cached max 30 days; place_id
  and our own computed scores/audits are kept permanently.
- Jobs update Scan.progress only through `setStepState()` (atomic; jobs run in parallel).
- Json blob shapes live in src/types.ts. Change a shape there first, then its readers.
- Screenshots and PDFs go in the Asset table, never on local disk.
- Keep files readable over "clever": plain functions, small modules, comments
  only where logic is non-obvious. No premature abstraction.
- Scoring math lives only in src/lib/scoring.ts and config/scoring.json.

## Style
- shadcn/ui components (base-ui primitives), Tailwind v4, minimal. Loading states use
  shadcn Skeleton and a stepper for the live scan.
- Server Components by default; "use client" only for interactive pieces.
- Errors shown to users are friendly; detail goes to pino logs.

## Verification per phase
Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm build:worker`
before declaring a phase done, then list the manual checks from the phase's acceptance criteria.
