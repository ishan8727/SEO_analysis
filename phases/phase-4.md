# Phase 4 — Scoring, report, live scan page

**Goal:** finished scans get a score; the scan page shows live progress and a teaser; unlocked visitors see the full report.

## Builds on

- Phase 1: `ScoreResult`, `Fix`, `ScanTeaser`, `ScanReport` in `src/types.ts`; `config/scoring.json`; `verifyUnlock()` + `unlockCookieName()`; `finalize.ts`.
- Phase 3: the audit blobs on `Scan`.

## Tasks

1. **`src/lib/scoring.ts`**: pure functions for every formula in SPEC.md section 11, reading `config/scoring.json`, plus `computeScore(scan) → ScoreResult` (fixes sorted by pointsLost / effort; online mode uses `online.weights`; missing website → webTech = onPage = 0 and the fix list leads with "No website on your Google profile"). Tests for every formula and the edge cases: no reviews, no competitors, no website, online mode.
2. **`finalize.ts`**: load the scan → `computeScore` → write `score`, `status: "done"`, `finishedAt`, `snapshotPurgeAt = now + 30 d`.
3. **`GET /api/scans/:id`**: rate limit `scanStatusIp`. Builds `ScanTeaser`, or `ScanReport` when the `unlock_<id>` cookie verifies. Locked data (competitor names, full fixes, sentiment detail) must not be in the teaser JSON at all.
4. **`GET /api/scans/:id/assets/:kind`**: serves `Asset` bytes; `pdf` requires the unlock cookie; `Cache-Control: private`.
5. **`/scan/[id]`** (SPEC.md section 9): stepper over `PROGRESS_STEPS`, skeletons, polling hook (2 s, 5 s after 30 s, stop on done/failed), teaser reveal (score ring, pillar bars, both screenshots, "You rank #N of M nearby"), locked sections blurred with `pointer-events: none`, and an empty slot for the Phase 5 gate card.
6. **`/report/[id]`**: not unlocked → redirect to `/scan/[id]`. Score ring, pillar bars, screenshots, competitor table + Leaflet map (client-only, self pin highlighted), fix checklist, sentiment card, GBP checklist, PSI details. Export a `ReportView` component that takes a `ScanReport` (Phase 5's print page reuses it).
7. **`scripts/seed-demo.ts`**: inserts a done scan with realistic blobs, so the UI can be built without API keys.

## Acceptance criteria

- Scoring tests pass.
- The scan page updates live as jobs finish.
- Locked sections are absent from the teaser JSON (not just hidden in CSS).
- The report renders cleanly on mobile.

## Notes

Next 16 Cache Components: `params` and `cookies()` are async and need `<Suspense>` around dynamic parts. Read the docs in `node_modules/next/dist/docs/` first.

**Prompt:** "Implement Phase 4 of SPEC.md from phases/phase-4.md. Teaser payload must exclude locked data server-side."
