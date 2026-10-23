# TODO — build tracker

Read this first in a new session, then SPEC.md and the brief for the current phase in `phases/`.
Build phases **one at a time, in order**. Stop after each phase and show the user how to verify it.

## Status

| Phase | Brief | Status |
|---|---|---|
| 1 Setup and infrastructure | phases/phase-1.md | ✅ Done, committed (`a7051d4`) |
| 2 Intake | phases/phase-2.md | 🟡 Code done, verified locally, committed (`b57b306`); a few checks left (see below) |
| 3 Audit engine | phases/phase-3.md | ✅ Done; acceptance checks passed with real keys (see below). Committed (`38ed8cd`, `8689c98`) |
| 4 Scoring, report, live scan page | phases/phase-4.md | 🟡 Built and verified locally; not committed yet (see below) |
| 5 International pass, lead gate (Firebase phone auth), PDF | phases/phase-5.md | 🟡 Built and verified locally (2026-10-23); not committed. Live SMS test after deploy (see below) |
| 6 Hardening, tests, deploy | phases/phase-6.md | ⬜ Not started |

## Phase 2 — remaining

- [ ] Rebuild the Docker image and check the containerised web + worker (the Dockerfile gained build args):
      `podman compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build web worker`, then
      `/api/health` is green and `/` renders. (The user stopped this step in the last session; ask before running.)
- [ ] Manual UI check in a real browser once Google keys exist: typing shows suggestions, picking redirects to `/scan/[id]`.
- [ ] Local-mode success path needs `GOOGLE_SERVER_KEY` + `NEXT_PUBLIC_GOOGLE_BROWSER_KEY` in `.env` (not set yet).
      Without the server key, local mode returns 500 `SCAN_FAILED` and logs "GOOGLE_SERVER_KEY is not set".

### Phase 2 verified so far (dev server + worker on the host)
- Online mode creates a scan, redirects target `/scan/[id]` renders, the flow finishes (`done`).
- Same website again within 7 days → same scan id.
- Invalid placeId → 400; private URL (`http://10.0.0.1`) → 400; 6th request in a minute → 429 + Retry-After.
- Turnstile failure (Cloudflare always-fail secret) → 403 `CAPTCHA_FAILED`.
- No server secrets or server-side Places calls in `.next/static`.
- typecheck, lint, 59 tests, `next build`, worker build all pass.

## Phase 3 — remaining

- [x] Real scan with keys (2026-10-23, Indiranagar dental clinics): all five blobs + both screenshots in 37.5 s and 43 s;
      Nearby Search returned 10, self dropped → 9 competitors. PSI is the slow step (~40 s per strategy, run in parallel).
- [x] Moli killed for real mid-scan (2026-10-23, `podman kill` during `page.goto`): dom fell back to
      `renderer: "fallback"`, scan `done` in 45 s with all five blobs. Moli restarted, `moli:smoke` passes.
- [x] Category types checked against real Bengaluru Text Search results (2026-10-23): all names valid
      (`mens_clothing_store` isn't). Lists widened to the primary types real places carry (e.g. CAs are
      `consultant`, physios `medical_clinic`); "Restaurant" now has no filter (too many cuisine subtypes for 5).

### Phase 3 verified so far (host worker, `pnpm scan:run`)
- Fixture place + example.com: gbp `done`, dom `done` via Moli (rendered DOM, JS-injected content included);
  competitors/psi/sentiment `failed` fast (missing keys → UnrecoverableError, no retries); scan reaches `done`.
- Fixture place without a website: psi + dom `skipped`, blobs null, scan `done`.
- Online mode (haldirams.com): dom via Moli in ~7 s; with `MOLI_URL` dead → `renderer: "fallback"`, same facts, 1.6 s.
- typecheck, lint, 84 tests, `next build`, worker build pass; no server key names or PSI/Places calls in `.next/static`.
- Gemini: full Flash (`gemini-flash-latest` → 3.8) timed out at 60 s / returned 503; switched to pinned
  `gemini-3.5-flash-lite` (1–2 s). 2.5 models are closed to new keys. Recorded in SPEC.md section 14.
- One PSI mobile call returned 403 right after the key restrictions were changed (propagation); repeats succeeded.

### Phase 3 notes for Phase 4
- A website on a denied host (e.g. a facebook.com page) is treated as no website: psi/dom `skipped`, but
  `gbp.checks.hasWebsite` is still true. Decide how the fix list words this.
- A step can end `failed` (e.g. site down, DNS failure) with a null blob; score it like a missing blob.
- `domAudit.napMatch`: a part Google has no data for reads 0 and is left out of `score` (see src/types.ts).
- dom audit: if robots.txt disallows our UA (or `*`) for the page, the step is `skipped`.
- DOM extraction runs cheerio over Moli's rendered `outerHTML` (one extractor for both renderers) instead of
  a separate `page.evaluate` per field.

## Phase 4 — verified (2026-10-23, `next start` + host worker)
- typecheck, lint, 120 tests (29 scoring, 7 teaser/report), `next build`, worker build pass; no server secret names in `.next/static`.
- Teaser JSON (`GET /api/scans/:id`) has no competitor names, sentiment text or fixes past the first 2 (checked with curl and in tests).
  A valid `unlock_<id>` cookie returns the full report; a tampered one returns the teaser. PDF asset → 401 without the cookie.
- Live page (headless Edge, `pnpm seed:demo --live`): the stepper and pillar bars update as steps finish; polling every 2 s, slower
  after 30 s, stops when done.
- Mobile (390 px): scan and report pages have no horizontal scroll. Report: map with the self pin highlighted, competitor table, fixes,
  sentiment, GBP checklist, PSI + on-page details.
- Real online scan (example.com) through the worker: finalize wrote the score (66, C, webTech + onPage only).

### Phase 4 decisions and notes
- Missing blob (failed or skipped step) scores 0 for what it feeds. A website we may not audit (psi `skipped`, e.g. a facebook.com
  page) scores like no website, with its own lead fix text; no GBP `hasWebsite` penalty.
- Interpretations of SPEC section 11 (all in src/lib/scoring.ts): title passes at 10–70 chars, meta description at 50–160;
  `contactLinks` = tel or WhatsApp link; `canonicalAndRobots` = canonical present and no `noindex`; `cwvPass` falls back to lab
  LCP ≤ 2.5 s and CLS ≤ 0.1 when there's no field data; sentiment falls back to the share of 4–5 star snapshot reviews when Gemini
  didn't run; volumeNorm with all-zero competitor reviews = 1 if you have any. Online mode drops NAP and accepts any JSON-LD for
  the schema item. Fixes under 0.5 points are dropped.
- Teaser: 2 fixes shown, the rest counted in `lockedFixCount` (3 blurred rows drawn). New optional `ScanTeaser.partialPillars`
  reveals pillars while the scan runs.
- `/scan/[id]` and `/report/[id]` still answer HTTP 200 for an unknown id (not-found page, noindex) and for a locked report
  (client-side redirect to /scan, no report data sent). Partial Prerender streams the layout shell first, even with
  `instant = false`. For real status codes, add a `proxy.ts` check in Phase 6 if wanted.
- Fixed a Phase 1 bug: `--font-sans` pointed at itself in globals.css, so every page rendered in a serif fallback font.
- Phase 5: put the gate card in the `gate` prop of `ScanLive` (src/components/scan/ScanLive.tsx); `ReportView` takes a `ScanReport`
  for the print page.

## Phase 5 — verified locally (2026-10-23, `next start` + host worker + Moli)
- typecheck, lint, 142 tests (9 verify-confirm, 1 print-html, 9 new phone-match), `next build`, worker build pass.
- `/api/verify/confirm` (firebase-admin mocked): cookie + `Lead` upsert keyed on scan + phone + PDF job; bad/stale/non-phone token → 401;
  number outside `NEXT_PUBLIC_PHONE_COUNTRIES` → 403; real firebase-admin rejects garbage and wrong-project tokens. Logs carry no phone or token.
- Gate (headless Edge, 390 px): renders on a locked scan, hidden once unlocked; country code defaults to the business's country; no
  horizontal scroll. "Text me a code" reaches Firebase from localhost (recaptchaConfig 200), then reCAPTCHA shows an image challenge to the
  headless browser, so the SMS step can't be automated here. Firebase SDK is not in the landing or scan page's initial chunks.
- PDF: print page (`/report/[id]/print?token=INTERNAL_TOKEN`) → worker inlines CSS + fonts → Moli `setContent` + `pdf()` → `pdf` Asset in
  2–3 s (A4, 2 pages for the demo). Download with cookie 200, without 401. `pnpm pdf:smoke` checks Moli.
- Migration `20261023120000_phase5_firebase_lead` applied to the dev DB (drops `Verification`, adds `Lead.firebaseUid/countryCode`, unique scan+phone).

### Phase 5 notes and limits
- **Moli doesn't paint raster images** (it loads them; `<img>` and CSS backgrounds both come out blank) and ignores CSS classes on SVG
  shapes. So the PDF leaves out the homepage screenshots (`print:hidden`), and ScoreRing sets SVG colours as attributes too.
- The print page answers HTTP 200 with the not-found page for a missing/wrong token (same PPR limitation as Phase 4); no report data is sent.
- If a visitor closes the reCAPTCHA challenge, the gate button stays on "Sending…" until they reload. Revisit after live testing.
- The consent line links to `/privacy`, which doesn't exist yet: Phase 6 must add the privacy policy page.
- Live checks left for after deploy on `audit.thesalesinc.com`: test number +1 650-555-0100 / 123456 end to end, one real SMS to an
  Indian number, wrong-code copy, and a full scan of a non-Indian business.
- Deploy needs the new build args (`NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_PHONE_COUNTRIES`) and `INTERNAL_APP_URL` for the worker.

## Decisions waiting on the user (SPEC.md section 13)
Phase 2 used these defaults; change them if the user answers differently:
- Countries: **international** (decided 2026-10-23). Phase 5 task 0 (international pass) is **done, not committed**: worldwide search with no country picker (Google ranks by visitor IP), country from Place Details, international phone/NAP matching, global host lists, neutral labels. typecheck, lint, 132 tests, `next build`, worker build pass. Not yet checked with a real key on a non-Indian business. `DEFAULT_COUNTRY` is now only the phone gate's last-resort default.
- Categories: 25 + "Something else" in `config/categories.json` (types unverified against Google until a key exists).
- Online-only mode: ships in v1 behind `ONLINE_MODE=on|off`.
- Phone verification: **Firebase Phone Auth (SMS)**, decided 2026-10-23; no WhatsApp. Report unlocks on the page + PDF download.
- Firebase (`tsi-project-cd47e`) is configured (2026-10-23); details in phases/phase-5.md "Firebase setup". Still the user's: a budget alert. Testing is live on `audit.thesalesinc.com` after deploy (no emulator).
- CRM: deferred by the user; leads stay in Postgres (`crmSyncedAt` null) for a later backfill.
- Google Places pricing: the Details/Nearby field masks bill at Enterprise tiers (SPEC.md section 1).

## Open housekeeping
- [ ] The user should delete the empty `project/CLAUDE.md/` folder (deleting it was blocked); project instructions live in `.claude/CLAUDE.md`.
- [ ] `/scan/[id]` and `/report/[id]` return HTTP 200 for unknown ids and locked reports (see Phase 4 notes). Optional `proxy.ts` in Phase 6.
- [ ] Worker logs say `service: "web"` under `pnpm worker:dev` (SERVICE_NAME only set in compose). Minor.

## Environment notes (Windows + Podman)
- Use `podman compose` (Docker isn't installed). Podman VM: `podman machine start`.
- Backing services for host dev: `podman compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis moli`.
- The web container also binds :3000. Stop it (`podman compose stop web worker`) before `pnpm dev`.
- Stopping a background `pnpm dev` task can leave the Next child process running and holding the port.
  Kill project node processes in PowerShell:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like "*Business Report\project*" } | % { taskkill /PID $_.ProcessId /T /F }`
- `pnpm test` needs Redis on localhost:6379 (rate-limit tests use DB 15).
- Local `.env` uses Cloudflare's always-pass Turnstile test keys. Don't read `.env` (denied in settings); edit specific keys with sed.
- `NEXT_PUBLIC_*` and `ONLINE_MODE` are Docker build args (inlined into the static landing page). `DEFAULT_COUNTRY` no longer is (2026-10-23).
