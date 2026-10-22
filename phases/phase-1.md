# Phase 1 — Setup and infrastructure (done)

## Built

- Next.js 16.4 + TS strict + Tailwind v4 + shadcn/ui (button, input, card, skeleton, select, dialog, badge, progress).
- Prisma 7 schema (SPEC.md section 7 + `Asset`) and the `init` migration; `src/lib/db.ts`.
- `src/lib/redis.ts`, `queue.ts` (job names, `enqueueScan`, `enqueuePdf`, `enqueuePing`), `log.ts`, `rate-limit.ts`, plus `env.ts`, `api.ts`, `hash.ts`, `unlock.ts`, `ssrf.ts`, `browser.ts`, `scan-progress.ts`.
- `src/types.ts`: shared data contracts.
- Worker (`src/worker/index.ts`) routing every job name; real `ping` job; placeholder audit jobs; `finalize` sets the scan to done.
- `GET /api/health` → `{ db, redis, moli }`.
- Dockerfile (one image, web + worker), `docker-compose.yml` (5 services), `docker-compose.dev.yml`, Moli image with Caddy token gate in `docker/moli/`.
- CI (`.github/workflows/ci.yml`): install, prisma generate, typecheck, lint, test (with a Redis service), build, worker build, secret-leak check.
- Tests: rate limit (real Redis), SSRF guard, unlock cookie + hashing — 41 tests.

## Acceptance criteria — results

| Criterion | Result |
|---|---|
| `docker compose up` brings up all five services | Pass (web, worker, moli, redis, postgres via Podman) |
| `/api/health` returns all green | Pass: `200 {"db":"ok","redis":"ok","moli":"ok"}` |
| `pnpm test` passes rate-limit tests | Pass: 41/41 |
| A ping job enqueued from a script is processed by the worker | Pass, both host worker (`pnpm queue:ping`) and containerised worker |
| Moli answers GET /json/version from inside the compose network only | Pass: 200 with token and 401 without from the worker container; connection refused from the host |

Also checked: a test scan runs through the whole flow (parallel steps → finalize → `done`, purge date set); Playwright drives Moli over CDP (navigate, DOM, screenshot, PDF).

## How to verify

```
docker compose up -d --build
curl http://localhost:3000/api/health          # {"db":"ok","redis":"ok","moli":"ok"}
docker compose exec worker node -e "fetch('http://moli:9222/json/version',{headers:{Authorization:'Bearer '+process.env.MOLI_TOKEN}}).then(r=>r.text()).then(console.log)"
docker compose down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis moli
pnpm test
pnpm worker:dev   # in another terminal
pnpm queue:ping
pnpm moli:smoke https://example.com
```
