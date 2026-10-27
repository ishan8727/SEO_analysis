# Phase 2 — Worker inside the web process

**Goal:** one Node process runs the pages, the API and the jobs. No `worker` container, no `tsup`, no `dist-worker/`.

## Builds on

Phase 1: jobs run on pg-boss through `src/lib/jobs.ts`, started by `src/worker/index.ts`. Scan speed is set by PSI and
outside APIs, not local CPU, so sharing a process with `next start` costs nothing noticeable at this traffic.

Read `node_modules/next/dist/docs/` on `instrumentation.ts` first. `register()` runs once per server process, before the
server takes requests. It runs under every runtime, so gate on `process.env.NEXT_RUNTIME === "nodejs"` and import the
worker dynamically. The file lives in `src/` next to `app/`.

## Tasks

1. **`src/worker/start.ts`** exports `startWorker()`. Move everything `src/worker/index.ts` does after Phase 1 into it:
   `startJobs()`, the `work()` registrations, the retention schedule, the logs. Add a shutdown hook on SIGTERM/SIGINT
   that calls `boss.stop({ graceful: true, timeout: 30_000 })` so running steps can finish. Make it idempotent: a second
   call (dev hot reload) is a no-op, guarded through `globalThis`.
2. **`src/instrumentation.ts`:**
   ```ts
   export async function register() {
     if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.WORKER_INLINE === "off") return;
     const { startWorker } = await import("@/worker/start");
     await startWorker();
   }
   ```
   Don't start the worker during `next build`. Check whether `register()` runs at build time in this Next version and
   guard it if so (e.g. `process.env.NEXT_PHASE`).
3. **Escape hatch.** Keep `src/worker/index.ts` as a tiny standalone entry (`startWorker()` and nothing else). Run it with
   `tsx` only. Setting `WORKER_INLINE=off` on web plus running this entry gives back a separate worker if ever needed.
   Note this in architecture.md.
4. **Remove the separate build.** Delete `tsup.config.ts`, the `tsup` devDependency, and the `build:worker`, `worker` and
   `worker:dev` scripts. `scripts/start-app.ts` starts only the backing services and `pnpm dev`. `pnpm dev` and
   `pnpm start` now process jobs by themselves.
5. **Compose and image.**
   - Delete the `worker` service in `docker-compose.yml` and `docker-compose.prod.yml`.
   - Web in prod: `mem_limit: 640m` and `NODE_OPTIONS: --max-old-space-size=512`.
   - `deploy/seo-audit.env`: `WORKER_CONCURRENCY=2`.
   - `Dockerfile`: drop `pnpm build:worker` and the `dist-worker` copy, and update the header comment ("one process").
   - `deploy/vm-deploy.sh`: the logs line on failed health lists `web moli` (Phase 3 makes it `web`).
   - `.dockerignore`: drop `dist-worker`.
6. **Logs.** `SERVICE_NAME` is `web` for everything now. Add `job` / `queue` fields to the job logs so they stay
   filterable in Cloud Logging.

## Docs to update

- `CLAUDE.md`: the first paragraph ("One Docker image runs two processes" becomes one process running pages, API and
  jobs) and the Commands list (no `worker:dev`, `build:worker`, `worker`). The per-phase verification line drops
  `pnpm build:worker`.
- `architecture.md`: sections 1 and 2 (web runs the jobs), and 10 (`WORKER_INLINE`, `WORKER_CONCURRENCY`).
- `SPEC.md`: the process model.
- `TODO.md`: environment note "Without the worker, scans stay queued" no longer applies; Resize status row.
- `setup.md`: two terminals become one.

## Acceptance criteria

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass. `next build` doesn't start the worker or touch the
  database.
- `pnpm dev` alone (no `worker:dev`) runs a full `pnpm scan:run` and a `pnpm seed:demo --live` scan.
- Three scans started together finish in the usual time.
- Container stack (ask the user before rebuilding): only `web`, `postgres` and `moli` run; `/api/health` is green;
  `podman stats` shows web under 600 MB during three parallel scans.
- Stopping web mid-scan: after restart the scan finishes (pg-boss expiry + retry) or ends `failed` with the friendly
  message. It never stays `running` forever.

**Prompt:** "Implement ResizePhases/phase-2.md on branch reducing-the-version (rules in ResizePhases/README.md), then run
the acceptance checks and commit."
