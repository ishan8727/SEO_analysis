# ResizePhases — run on a small machine

Branch: `reducing-the-version`. Started 2026-10-27. The user asked for the same features and the same scan speed on a
smaller machine, staying inside the current GCP setup: one Compute Engine VM with compose, plus Cloud Build, Artifact
Registry and Secret Manager.

## Why

Production reserves about 2.4 GB for this one app (`docker-compose.prod.yml`). Most of it is plumbing, not features:

| Service | Today | After | What replaces it |
|---|---|---|---|
| web | 768 MB | 640 MB | same, now also runs the jobs |
| worker | 512 MB | — | runs inside web (Phase 2) |
| moli | 384 MB | — | DOM audit by fetch + cheerio; PDF printed by the visitor's browser (Phase 3) |
| redis | 192 MB | — | Postgres: pg-boss queue, rate-limit table, sentiment cache column (Phase 1) |
| postgres | 512 MB | 256 MB | tuned for this small workload (Phase 4) |
| **Total** | **≈ 2.4 GB** | **≈ 0.9 GB** | 5 containers → 2 |

The result fits an `e2-small` (2 GB) on its own, or leaves most of the shared `e2-medium` free for other apps.

Scan speed does not change. PSI sets the scan time (~40 s per strategy, both run in parallel), and the five audit steps
still run in parallel. The DOM step gets faster: fetch took ~1.6 s against ~7 s for Moli when measured in build Phase 3.

## Decisions (user, 2026-10-27)

- Queue, rate limits and caches move from Redis to Postgres (pg-boss).
- The worker runs inside the web process, started from `src/instrumentation.ts`.
- PDF: **browser-side print only**. "Download PDF" opens `/report/[id]/print`, which opens the browser's print dialog
  (Save as PDF). No server PDF, no Moli, no outside PDF API.
- Screenshots are unaffected. They come from the PSI response, not Moli.

## Order and status

Do the phases in order. Each phase is one commit on `reducing-the-version` and leaves the app working.

| Phase | Brief | Removes | Status |
|---|---|---|---|
| 1 | [phase-1.md](phase-1.md) Queue, rate limits, cache on Postgres | Redis, bullmq, ioredis | ⬜ |
| 2 | [phase-2.md](phase-2.md) Worker inside the web process | worker container, tsup, dist-worker | ⬜ |
| 3 | [phase-3.md](phase-3.md) Moli out, PDF printed by the browser | moli container, PDF job, internal print token | ⬜ |
| 4 | [phase-4.md](phase-4.md) Dependency and image diet, Postgres tuning | firebase-admin, cn, oversized Postgres | ⬜ |
| 5 | [phase-5.md](phase-5.md) Resize, deploy, live checks | old containers and secrets on the VM | ⬜ needs the user |

Phases 1 to 4 are code only. Each can be handed to a subagent, one at a time. Phase 5 needs the user: merge to `main`,
deploy, resize the VM, delete secrets. Never run phases in parallel, because each builds on the previous one's files.

## Rules for whoever implements a phase

- Read `CLAUDE.md`, `TODO.md`, `SPEC.md` and `architecture.md` first, then the brief. The Hard rules in `CLAUDE.md` still
  apply: zod + rate limit + `apiError()` on every route, `safeFetch` for user URLs, `setStepState()` for progress, blob
  shapes in `src/types.ts` first, scoring only in `src/lib/scoring.ts`.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (Phase 2 instrumentation, Phase 3
  print page).
- Read the installed pg-boss docs and types in `node_modules/pg-boss` before using its API. Don't code it from memory.
- Keep behaviour the same unless the brief says otherwise. No new features, no redesigns.
- Finish with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm build:worker` until Phase 2 removes it.
- Update the docs the brief lists (SPEC.md, architecture.md, runbook.md, TODO.md, CLAUDE.md) in the same commit.
- Mark the phase ✅ in the table above and in `TODO.md`, with the commit hash.
- Do **not** run `podman compose up --build`, deploy, push, or touch GCP without asking the user.

## Hand-off prompt for a subagent

> Implement `ResizePhases/phase-N.md` on branch `reducing-the-version` in `I:\TSI\Business Report\project`. Read CLAUDE.md,
> TODO.md, SPEC.md, architecture.md and `ResizePhases/README.md` first. Keep behaviour the same unless the brief says
> otherwise. Finish with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, update the docs the brief lists, mark
> the phase done in `ResizePhases/README.md` and `TODO.md`, and commit. Do not rebuild the compose stack, deploy or push
> without asking. Report what you verified and anything you could not.

## Verification ladder

1. **Unit:** `pnpm test`. After Phase 1 it needs Postgres, not Redis.
2. **Host dev:** `pnpm start:app`, then `pnpm scan:run <placeId|url>` and `pnpm seed:demo --live`.
3. **Containers** (ask the user first): `podman compose up -d --build`, `/api/health`, three scans at once, `podman stats`.
4. **Live** (Phase 5, after merge to `main`): the user runs `bash scripts/deploy.sh`.
