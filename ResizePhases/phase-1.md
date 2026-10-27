# Phase 1 — Queue, rate limits and cache on Postgres; Redis out

**Goal:** no Redis container and no `bullmq` or `ioredis`. Same parallel audit steps, same retry and failure behaviour,
same rate limits, same 30-day sentiment cache.

## Builds on

`main` at `6a3108f`. Redis does three jobs today:

| Use | Where | Replacement |
|---|---|---|
| BullMQ queue `scan`: flow of 5 steps then `finalize`, plus `pdf`, `lead-webhook`, `retention` cron, `ping` | `src/lib/queue.ts`, `src/worker/index.ts` | pg-boss in schema `pgboss` |
| Sliding-window rate limits on sorted sets | `src/lib/rate-limit.ts` | `RateLimitEvent` table |
| Gemini result cache, 30 days per place | `src/worker/jobs/sentiment.ts:25-33` | `Business.sentiment` + `sentimentAt` |

Read the installed pg-boss docs and types before writing code (`node_modules/pg-boss`). pg-boss needs Node 22.12+ and
Postgres 13+; we have Node 22 and Postgres 16. The `pdf` job stays in this phase (Phase 3 deletes it), so port it like the
others.

## Tasks

1. **pg-boss module.** `pnpm add pg-boss`. New `src/lib/jobs.ts` replaces `src/lib/queue.ts`:
   - Lazy singleton `getBoss()` with `connectionString: env().DATABASE_URL`, `schema: "pgboss"` and a small pool
     (e.g. `max: 4`).
   - `startJobs()`: `boss.start()` once, then `createQueue()` for `scan`, `pdf`, `lead-webhook`, `retention`, `ping`.
   - Senders keep today's names and arguments: `enqueueScan(scanId, mode)`, `enqueuePdf(scanId, leadId)`,
     `enqueueLeadWebhook(leadId)` (6 attempts, 30 s exponential backoff, as today), `enqueuePing()`.
   - Dedupe like today's fixed job ids. The same scan sent twice while queued or active must run once. Use
     `singletonKey` = scanId, or whichever queue policy gives this (check the docs). Same for `pdf`
     (`${scanId}-pdf-${leadId}`) and `lead-${leadId}`.
   - Keep the job data types (`ScanJobData`, `PdfJobData`, `LeadJobData`, `PingJobData`) and the `JOB` names.
   - Export `class UnrecoverableError extends Error` with name `"UnrecoverableError"`. Switch every `UnrecoverableError`
     import from `bullmq` to `@/lib/jobs`: `competitors.ts`, `gbp.ts`, `psi.ts`, `sentiment.ts`, `lead-webhook.ts`,
     `pdf.ts`.
2. **One `scan` job runs the whole flow.** New `src/worker/run-scan.ts` exporting `runScan(scanId)`:
   - Read the scan's mode and run `STEPS_BY_MODE[mode]` (`src/types.ts`) with `Promise.allSettled`, so the steps stay
     parallel.
   - Wrap each step in `runStep(step, fn)`. A normal throw retries once after 2 s, matching today's `attempts: 2` with a
     2 s exponential backoff. `UnrecoverableError` or a second failure calls `setStepState(scanId, step, "failed")` from
     `src/lib/scan-progress.ts` and logs like the current `failed` handler.
   - Then call `finalizeJob`. If it throws, retry once. If it fails again, call `markScanFailed(scanId, "We couldn't
     finish this audit. Please try again in a few minutes.")` (today's text in `src/worker/index.ts`).
   - pg-boss options for `scan`: step errors are handled inside, but set `expireInSeconds: 180` and one retry so a scan
     cut off by a restart runs again. Steps are idempotent because each overwrites its own blob.
   - Step handlers drop the BullMQ `Job` type and take `{ data: ScanJobData }` or just `scanId`. Keep the changes small.
3. **Worker entry.** `src/worker/index.ts`: `startJobs()`, then `work()` per queue with a handler map as today.
   - Scan concurrency comes from `WORKER_CONCURRENCY` (default 2).
   - Replace `upsertJobScheduler` with `schedule("retention", "30 21 * * *", {}, { tz: "UTC" })`.
   - Keep the ready, completed and failed logs.
   - On SIGTERM or SIGINT: `boss.stop({ graceful: true })`, then `db.$disconnect()`.
   - The lead webhook reads `job.attemptsMade` today (`lead-webhook.ts:183`). Use pg-boss's retry count field instead.
4. **Rate limits on Postgres.** Prisma model
   `RateLimitEvent { id String @id @default(cuid()); key String; at BigInt; @@index([key, at]) }`.
   - Port `rateLimit()` 1:1 inside one `db.$transaction`: delete the key's rows older than the window, insert, count.
     Over the limit: delete the inserted row and read the oldest `at` for `Retry-After`.
   - `RATE_LIMITS` and `enforceRateLimits(checks)` keep their shape. Drop the `redis` parameter; tests may inject a
     client instead.
   - Keys stay `rl:<name>:<hashIdentifier(subject)>`. Never store a raw IP or phone.
5. **Sentiment cache on Business.** Add `sentiment Json?` and `sentimentAt DateTime?` to `Business`. In `sentiment.ts`,
   reuse the cached result when `sentimentAt` is under 30 days old. Otherwise call Gemini and write both fields. The shape
   stays `SentimentResult`.
6. **Retention job** (`src/worker/jobs/retention.ts`): also delete `RateLimitEvent` rows older than 24 h, and null
   `Business.sentiment` and `sentimentAt` older than 30 days (the Google content rule in SPEC).
7. **Migration** `prisma/migrations/20261027000000_resize_pg_queue/`. Generate the SQL with
   `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (see TODO.md environment
   notes), then run `pnpm prisma migrate deploy` and `pnpm prisma generate`. pg-boss creates its own schema at `start()`.
8. **Health.** `/api/health` returns `{ db, jobs, moli }`. `jobs` means pg-boss started and answers within 3 s. `moli`
   stays until Phase 3. Answer 503 if any is down.
9. **Remove Redis.**
   - Delete `src/lib/redis.ts` and `src/lib/queue.ts`.
   - Remove `REDIS_URL` from `src/lib/env.ts`, `.env.example`, and both compose files (service, volume, `depends_on`, env).
     Also check `docker-compose.dev.yml`.
   - Remove `bullmq` and `ioredis` from `package.json` and from `serverExternalPackages` in `next.config.ts`. Add
     `pg-boss` there.
10. **Scripts.**
    - `scripts/ping.ts`: send, then poll the job state until completed, with a 30 s timeout.
    - `scripts/run-scan.ts` and `scripts/seed-demo.ts`: use `@/lib/jobs`. Drop the `process.exit` workaround at the end
      of seed-demo if it is no longer needed.
    - `scripts/start-app.ts`: no `redis` in the `up --wait` list.
11. **Tests.**
    - `tests/rate-limit.test.ts`: run against Postgres (`DATABASE_URL`) with a unique key prefix per run, and clean up
      after. Same cases as today.
    - `tests/lead-webhook.test.ts`: build the fake job without the bullmq type.
    - `tests/verify-confirm.test.ts`: mock `@/lib/jobs` instead of `@/lib/queue`.
    - New `tests/run-scan.test.ts`, with the step handlers and `setStepState` mocked. A step that throws twice ends
      `failed` and finalize still runs. `UnrecoverableError` is not retried. Steps start in parallel. Finalize failing
      twice marks the scan failed.
    - Test setup: no Redis needed any more.
12. **Backups.** `deploy/backup.sh`: add `--exclude-schema=pgboss` to `pg_dump`. Queue state isn't worth restoring.

## Docs to update

- `CLAUDE.md`: `pnpm test` needs Postgres instead of Redis; drop `REDIS_URL` from the server-only list.
- `SPEC.md`: every Redis mention (queue, limits storage, sentiment cache), plus a dated decision note in section 14.
- `architecture.md`: section 1 (diagram: drop Redis, show pg-boss inside Postgres), sections 2, 7 (one `scan` job with
  parallel steps), 8 and 10.
- `runbook.md`: section 4 (backup skips `pgboss`); section 5 (a failed scan: rescan; queue state with
  `SELECT name, state, count(*) FROM pgboss.job GROUP BY 1, 2`); any other Redis mention.
- `TODO.md`: environment notes (`pnpm test` needs Postgres) and the Resize status row.

## Acceptance criteria

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm build:worker` pass with **no Redis running**.
- `pnpm start:app` plus `pnpm scan:run <real placeId>` produces all five blobs. The logs show the steps running in
  parallel, and total time matches before (PSI-bound, ~40–50 s).
- The same scan sent twice runs once. A failing step ends `failed`, and the scan still reaches `done` with a score.
- The 6th `POST /api/scans` from one IP within a minute returns 429 with `Retry-After`.
- A second scan of the same place within 30 days doesn't call Gemini.
- `pnpm queue:ping` passes. The lead webhook retries when Make.com answers 500 (test).
- `/api/health` returns `{ "db": "ok", "jobs": "ok", "moli": "ok" }`.
- `grep -rE "ioredis|bullmq|REDIS_URL" src scripts tests docker-compose*.yml` finds nothing.

**Prompt:** "Implement ResizePhases/phase-1.md on branch reducing-the-version (rules in ResizePhases/README.md), then run
the acceptance checks and commit."
