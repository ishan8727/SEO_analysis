# Build phases

Progress and next steps are tracked in `../TODO.md`. Build these **one at a time, in order**. Each phase builds on the previous one's output,
so don't start a phase until the one before it passes its acceptance criteria.

| Phase | Brief | Status |
|---|---|---|
| 1 | [Setup and infrastructure](phase-1.md) | Done |
| 2 | [Intake](phase-2.md) | Code done; see TODO.md for what's left |
| 3 | [Audit engine](phase-3.md) | — |
| 4 | [Scoring, report, live scan page](phase-4.md) | — |
| 5 | [Lead gate, WhatsApp, PDF, CRM](phase-5.md) | — |
| 6 | [Hardening, tests, deploy](phase-6.md) | — |

## Running a phase

Prompt for Claude Code:

> Read SPEC.md and phases/phase-N.md. Implement Phase N exactly as written, then stop and show me how to verify it.

Before declaring a phase done:

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm build:worker
```

Then walk through the phase's acceptance criteria by hand and update the status table above.

## Dev environment

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis moli
pnpm prisma migrate dev     # applies migrations, regenerates the client
pnpm dev                    # web on :3000
pnpm worker:dev             # worker
```

Full stack in containers: `docker compose up --build` (Podman: `podman compose up --build`).

## What Phase 1 already provides

- Shared data shapes for every Scan Json column and both API payloads: `src/types.ts`.
- The scan flow: `enqueueScan(scanId, mode)` runs the audit steps in parallel, then `finalize`.
  Each step is a placeholder in `src/worker/jobs/` that marks itself `skipped`. Later phases
  replace job bodies; job names and ids stay as they are.
- Platform helpers every phase uses: `env()`, `apiError()`, `getClientIp()`, `enforceRateLimits()`,
  `hashIdentifier()`, `signUnlock()`/`verifyUnlock()`, `safeFetch()`/`assertPublicUrl()`,
  `withPage()` (Moli), `setStepState()`, `log`.
