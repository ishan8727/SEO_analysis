# Phase 3 — Moli out; the PDF is printed by the browser

**Goal:** no `moli` container, no `playwright-core` at runtime, no PDF job. Verified visitors still get "Download PDF".

## Builds on

Phase 2: one web process runs the jobs. Moli has exactly two uses today:

| Use | File | Replacement |
|---|---|---|
| Render the homepage for the on-page audit | `src/worker/jobs/dom-audit.ts` (`renderWithMoli`) | the existing fetch fallback (`safeFetch` + cheerio), already the path when Moli is down |
| Print the report to PDF | `src/worker/jobs/pdf.ts` | the visitor's browser prints `/report/[id]/print` (decided by the user 2026-10-27) |

Screenshots don't use Moli. They come from the PSI response (`src/worker/jobs/psi.ts`) and stay as they are.

Known trade-off, to record in SPEC section 14: a client-rendered site (content injected by JavaScript) is audited from
its HTML shell, so title, meta or H1 set by scripts may read as missing. PSI's `seo` category, already fetched, still
scores the rendered page. Server-rendered sites, the large majority of local-business sites, give the same facts as
before.

Read `node_modules/next/dist/docs/` on client components and `cookies()` before changing the print page.

## Tasks

1. **DOM audit by fetch only.** In `dom-audit.ts`, delete `renderWithMoli` and `MOLI_TIMEOUT_MS`. Rename `fetchFallback`
   to `fetchPage`. Keep the robots.txt and sitemap logic unchanged. In `src/types.ts`, `DomAuditResult.renderer` becomes
   `"fetch" | "moli"`: new scans write `"fetch"`, old rows keep `"moli"`. Grep to confirm nothing scores or displays on
   `renderer` (scoring test fixtures may need `"fetch"`). Update the comment at `src/lib/page-audit.ts:5`.
2. **Print page guarded by the unlock cookie.** `src/app/report/[id]/print/page.tsx` checks the cookie exactly like
   `src/app/report/[id]/page.tsx` (`verifyUnlock`, `unlockCookieName` from `src/lib/unlock.ts`). Without a valid cookie,
   redirect to `/scan/[id]`; no report data is sent. Remove the `INTERNAL_TOKEN` header check.
3. **Print on open.** New client component `src/components/report/PrintOnLoad.tsx`: after `document.fonts.ready`, call
   `window.print()` once. Render it on the print page.
4. **Print styles** in `src/app/globals.css`:
   - `@page { size: A4; margin: 12mm 10mm; }`. Use Letter for the countries in today's `LETTER_COUNTRIES` (`pdf.ts`):
     put `data-paper="letter"` on `<main>` and add a named `@page` rule.
   - `print-color-adjust: exact` where colours carry meaning (score ring, pillar bars, grade badge).
   - Hide on print anything that is screen-only. If the Leaflet map prints badly, hide its tiles and keep the competitor
     table.
   - Screenshots now print (real browsers paint images): remove their `print:hidden`, and update the comments at
     `ReportView.tsx:50` and `labels.ts:57` (the SVG colour attributes can stay; they do no harm).
5. **"Download PDF" button.** `src/components/report/PdfButton.tsx` becomes a plain link to `/report/[id]/print` with
   `target="_blank"`, same label and icon. No polling, no "Preparing your PDF…" state. Its only prop is `scanId`.
6. **Remove the server PDF path.**
   - Delete `src/worker/jobs/pdf.ts`, `enqueuePdf`, the `pdf` queue and job name.
   - Delete `src/lib/print-html.ts` and `tests/print-html.test.ts`.
   - `/api/verify/confirm` no longer queues a PDF. The lead webhook job stays.
   - Remove `"pdf"` from `ASSET_KINDS` (`src/types.ts`) and the `Content-Disposition` branch in
     `src/app/api/scans/[id]/assets/[kind]/route.ts`. Existing `pdf` asset rows can stay; they go with their scan.
   - Remove `pdfUrl` from `ScanReport` (`src/types.ts`) and `src/lib/scan-view.ts`.
7. **Remove Moli.**
   - Delete `src/lib/browser.ts`, `scripts/moli-smoke.ts`, `scripts/pdf-smoke.ts`, `docker/moli/`, and their
     `package.json` scripts (`moli:smoke`, `pdf:smoke`).
   - Remove the `moli` service from both compose files and from `depends_on`.
   - `cloudbuild.yaml`: remove the `moli` step and its images. `scripts/deploy.sh` (around lines 67-68): stop checking
     the `moli` image.
   - Remove `MOLI_URL`, `MOLI_TOKEN`, `INTERNAL_TOKEN` and `INTERNAL_APP_URL` from `src/lib/env.ts`, compose,
     `.env.example`, `deploy/vm-deploy.sh` (`SECRETS` list, logs line becomes `web`) and `scripts/gcp/setup.sh`
     (secrets loop).
   - `/api/health` returns `{ db, jobs }`.
   - `next.config.ts`: remove `playwright-core` from `serverExternalPackages`. Move `playwright-core` to
     `devDependencies`, or drop it if no script uses it any more.
   - CSP in `src/lib/security-headers.ts`: nothing Moli-specific is expected, but check.
8. **Scripts and fixtures.** `scripts/seed-demo.ts` no longer queues a PDF and writes `renderer: "fetch"`.
   `scripts/start-app.ts` doesn't start `moli`.
9. **Tests.**
   - New test: the print page redirects without the cookie and renders the report with a valid one (follow the pattern
     in `tests/scan-routes.test.ts` / `tests/scan-view.test.ts`).
   - `tests/verify-confirm.test.ts`: no `enqueuePdf` expectation.
   - Scoring fixtures: `renderer: "fetch"` where it matters.

## Docs to update

- `SPEC.md`: the PDF section (browser print), every Moli mention, section 14 decision with the client-rendered trade-off.
- `architecture.md`: sections 1 to 5 (diagram without Moli, flow 5 becomes "report → print page → browser print"),
  6 (route table: print page guard = unlock cookie), 7 (no `pdf` job), 9 (trust boundaries: no Moli), 10 (config).
- `runbook.md`: secrets list. `seo-audit-MOLI_TOKEN` and `seo-audit-INTERNAL_TOKEN` are no longer read and can be deleted
  in Phase 5. Part B steps.
- `phases/phase-5.md`: one line saying the PDF path changed in ResizePhases/phase-3.
- `CLAUDE.md`: drop the Moli hard rule (`withPage()`, `assertPublicUrl` before Moli navigates); keep `safeFetch`. Drop
  `MOLI_TOKEN` and `INTERNAL_TOKEN` from the server-only list and the `moli:smoke` / `pdf:smoke` commands. Drop
  "Screenshots and PDFs go in the Asset table" down to screenshots.
- `TODO.md`: Resize status row; the Phase 5 note about Moli not painting images is resolved.

## Acceptance criteria

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.
- `pnpm scan:run` on a real site: `domAudit.renderer` is `"fetch"`, the facts match a pre-change scan of the same site,
  and the DOM step takes about 2 s.
- With `pnpm seed:demo --live` and the unlock cookie: "Download PDF" opens the print page in a new tab and the print
  dialog appears in Edge. The saved PDF has the score ring in colour, the pillar bars, competitors, fixes and the
  homepage screenshots, on A4 (Letter for a US business).
- `/report/[id]/print` without the cookie redirects to `/scan/[id]` and sends no report data.
- `grep -riE "moli|INTERNAL_TOKEN|INTERNAL_APP_URL|withPage" src scripts docker deploy cloudbuild.yaml docker-compose*.yml`
  finds nothing.
- Container stack (ask first): only `web` and `postgres` run; `/api/health` is green.

**Prompt:** "Implement ResizePhases/phase-3.md on branch reducing-the-version (rules in ResizePhases/README.md), then run
the acceptance checks and commit."
