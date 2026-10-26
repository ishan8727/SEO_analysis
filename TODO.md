# TODO — build tracker

Read this first in a new session, then SPEC.md and the brief for the current phase in `phases/`.
Build phases **one at a time, in order**. Stop after each phase and show the user how to verify it.

## Current stage (2026-10-23)

Phases 1–5 are built, committed and pushed to `main` (GitHub `ishanchaudhary-eng/TSI_Business_Analyzer`). The whole UI works
locally (`pnpm start:app`, see `setup.md`): search → live scan → teaser → phone gate → full report → PDF. **Next: Phase 6** (hardening + deploy to
`audit.thesalesinc.com` on **Google Cloud**: one Compute Engine VM in asia-south1 running the compose stack; brief refreshed 2026-10-24). The phone gate's SMS step can only be proven live after
deploy. `architecture.md` maps every service and integration.

## Status

| Phase | Brief | Status |
|---|---|---|
| 1 Setup and infrastructure | phases/phase-1.md | ✅ Done, committed (`a7051d4`) |
| 2 Intake | phases/phase-2.md | ✅ Done, committed (`b57b306`); two manual checks left (see below) |
| 3 Audit engine | phases/phase-3.md | ✅ Done; acceptance checks passed with real keys. Committed (`38ed8cd`, `8689c98`) |
| 4 Scoring, report, live scan page | phases/phase-4.md | ✅ Done, committed (`d303ff8`) |
| 5 International pass, lead gate (Firebase phone auth), PDF | phases/phase-5.md | ✅ Built, verified locally, committed (`0e3054c`, follow-up `ff8af71`). Live SMS tests wait for deploy |
| 6 Hardening, tests, deploy (GCP VM) | phases/phase-6.md | 🟡 In progress: deploy pipeline, retention, lead webhook, CI built (`35e63f6`, `dfa6b40`); first deploy waits on the user |

Also committed: `architecture.md` (service map) and `setup.md` (run it on Windows) in `ff8af71`.

## Phase 2 — remaining

- [ ] Rebuild the Docker image and check the containerised web + worker (build args grew again in Phase 5: Firebase + phone
      countries; compose sets `INTERNAL_APP_URL`): `podman compose up -d --build`, then `/api/health` is green, `/` renders, and a
      demo PDF is made by the containerised worker. **Ask before running** (the user stopped an unannounced rebuild before).
- [ ] Manual UI check in a real browser: typing shows suggestions, picking redirects to `/scan/[id]`. Needs the browser key's
      website list to include `http://localhost:3000/*` (not verified).
- [x] Local-mode success path with real keys: done in Phase 3 (real Bengaluru scans through the worker).

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

## Phase 5 — verified locally (2026-10-23, `next start` + host worker + Moli); committed `0e3054c`
- typecheck, lint, 142 tests (9 verify-confirm, 1 print-html, 9 new phone-match), `next build`, worker build pass.
- `/api/verify/confirm` (firebase-admin mocked): cookie + `Lead` upsert keyed on scan + phone + PDF job; bad/stale/non-phone token → 401;
  number outside `NEXT_PUBLIC_PHONE_COUNTRIES` → 403; real firebase-admin rejects garbage and wrong-project tokens. Logs carry no phone or token.
- Gate (headless Edge, 390 px): renders on a locked scan, hidden once unlocked; country code defaults to the business's country; no
  horizontal scroll. "Text me a code" reaches Firebase from localhost (recaptchaConfig 200), then reCAPTCHA shows an image challenge to the
  headless browser, so the SMS step can't be automated here. Firebase SDK is not in the landing or scan page's initial chunks.
- PDF: print page (`/report/[id]/print`, `INTERNAL_TOKEN` in the `x-internal-token` header, never the URL) → worker inlines CSS + fonts → Moli `setContent` + `pdf()` → `pdf` Asset in
  2–3 s (A4, 2 pages for the demo). Download with cookie 200, without 401. `pnpm pdf:smoke` checks Moli.
- Migration `20261023120000_phase5_firebase_lead` applied to the dev DB (drops `Verification`, adds `Lead.firebaseUid/countryCode`, unique scan+phone).

### Phase 5 notes and limits
- **Moli doesn't paint raster images** (it loads them; `<img>` and CSS backgrounds both come out blank) and ignores CSS classes on SVG
  shapes. So the PDF leaves out the homepage screenshots (`print:hidden`), and ScoreRing sets SVG colours as attributes too.
- The print page answers HTTP 200 with the not-found page for a missing/wrong token (same PPR limitation as Phase 4); no report data is sent.
- If a visitor closes the reCAPTCHA challenge, the gate button stays on "Sending…" until they reload. Revisit after live testing.
- The consent line links to `/privacy`, which doesn't exist yet: Phase 6 must add the privacy policy page.
- Live checks left for after deploy (listed under "Phase 6 — next").
- Deploy needs the new build args (`NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_PHONE_COUNTRIES`) and `INTERNAL_APP_URL` for the worker.
- Follow-up `ff8af71`: the print page takes `INTERNAL_TOKEN` in the `x-internal-token` header (the URL form leaked into the dev request
  log; the token was rotated); the print page calls `connection()` before `new Date()`; `seed:demo` queues the PDF and exits.

## Results behind OTP (2026-10-26, user request)
- Every result is behind phone verification. Not verified: `GET /api/scans/:id` and the page HTML carry status + progress only
  (`ScanLocked`, `verification: "not_verified"`); no score, pillars, rank, screenshots or fixes. Screenshots now need the unlock
  cookie too (401 without). Verified: `ScanReport` (`verification: "verified"`). Teaser fields (`fixesPreview`, `lockedFixCount`) are gone.
- Done scan, not verified: loader finishes → locked wall (`src/components/scan/ResultsWall.tsx`) comes in card by card, placeholder
  ring and bars fill (globals.css `.wall-*`, off under reduced motion) → gate pop-up rises 1.7 s later (`POPUP_DELAY_MS`) in the brand
  theme. Esc/X closes it, "Verify to view" reopens it at once. Non-modal Base UI dialog with its own backdrop, because a
  modal one makes the reCAPTCHA challenge (injected into `<body>`) inert. Check the challenge is clickable on the live site.
- Verified (Playwright + Edge, demo scans): no result in 11 polls of a live scan or in its HTML; pop-up opens only after the audit
  finishes; 390 px has no horizontal scroll; verified visitor gets no pop-up. Tests: `tests/scan-routes.test.ts`, `tests/scan-view.test.ts`.

## Branding (2026-10-26, user request)
- Favicon + app icons from the brand GIF frame 0 (`src/app/favicon.ico` 16/32/48, `icon.png` 192, `apple-icon.png` 180).
- Wording: no "local SEO audit"/"free" anywhere; title template "… · TSI - SEO audit", labels "SEO audit by TSI".
- Logo: the ASCII reveal is pre-rendered (`pnpm logo:build` films `AsciiLogoSource` on the dev-only `/dev/logo-capture`,
  404 in production) into `public/brand/logo-{hero,compact}.webp` (play once) + stills + hover stills.
  2026-10-26 fix (user: "broken/ugly", esp. on mobile): first capture was at 2x, where the glyphs' shading texture
  shows and looks broken once scaled. Now captured at 1x (laptop look: hero 448×224 323 KB, compact 180×90 67 KB)
  and scaled up with `image-rendering: pixelated`; widths give whole-number scales (phone hero 299 px, compact 120 px). `SalesAsciiLogo` is now a plain `<img>` in the server HTML: shows ~150 ms after load instead of
  ~1.5 s after the font and canvas work; glow after the reveal, hover/tap = stronger glow, lift, arrows nudge.
  Hero is 299 px on phones (was 45vw = 176 px). Check on a real iPhone after deploy (the old canvas logo was missing there).

## Phase 6 — next

**Live (2026-10-26):** https://audit.thesalesinc.com, deployed `c02cf75` by the user (`bash scripts/deploy.sh`; Claude's runs of
the production deploy are blocked by the auto-mode classifier). First deploy `d5faf83` crash-looped: the runtime image lacked
`src/lib/security-headers.ts`, which `next.config.ts` imports (fixed in `c02cf75`). Next: Phase 5 live checks (below), the
acceptance checks, then tasks 14 (e2e), 15 (load test), 16 (PostHog), the uptime check. Branches (2026-10-26): only `main`
remains (user deleted the rest, locally and on GitHub). GitHub's `main` is what's live; `scripts/deploy.sh` builds only a
clean `main` that matches `origin/main` (workflow: runbook.md section 2).
- Deploy pipeline (2026-10-26): commit → `scripts/deploy.sh` → Cloud Build (`cloudbuild.yaml`, SA `seo-audit-build`, source
  bucket `gs://tsi-project-cd47e-seo-audit-build`) → Artifact Registry `seo-audit/{app,moli}:<sha>` → VM `deploy/vm-deploy.sh`
  (`.env` from Secret Manager, pull, up, edge reload, backup timer, health wait). Rollback: `scripts/deploy.sh <tag>`.
  No auto-deploy on push yet (CI only checks). Public build values in `.env.deploy` (gitignored, created 2026-10-26).
- Make.com webhook (`src/worker/jobs/lead-webhook.ts`): URL from the user stored as secret `seo-audit-LEAD_WEBHOOK_URL`
  (2026-10-26), live with the first deploy. Payload: lead (phone, role + label, verifiedAt), business (name, website,
  address, phone, Maps link, category, country), audit (score, grade, pillars, rank, top 5 fixes, report URL); no Google
  rating/reviews/hours (30-day rule). Test event sent with `pnpm lead:test` (Firebase test number, `test: true`), Make answered 2xx.

Hosting decided 2026-10-24 (user): **GCP only**, Railway dropped. One Compute Engine VM (`e2-medium`, asia-south1) running
compose + Caddy for HTTPS (2026-10-26: shared host `tsi-apps-1` for several apps, one edge Caddy, per-app `seo-audit-*` resources), images from Cloud Build / Artifact Registry, secrets in Secret Manager, Postgres + Redis on the VM
with nightly `pg_dump` to Cloud Storage, in project `tsi-project-cd47e` (confirmed 2026-10-24). Full task list in `phases/phase-6.md`.
- [ ] **User:** one-time GCP setup, `runbook.md` section 1: Part A shared host (VM, firewall, edge Caddy), Part B for `seo-audit`
  (registry, bucket, secrets, key, DNS). 2026-10-26: `scripts/gcp/setup.sh` run, all checks green (VM `tsi-apps-1`
  34.14.137.215, Docker + compose 5.6.1, json-file logs → Ops Agent, metadata blocked for containers, edge Caddy on `edge-seo-audit`).
  User then added the two real secrets and the DNS A record `audit` → 34.14.137.215 (verified: 8 secrets, DNS resolves). Phase 6 code waits on it
  only for the live deploy.

Notes carried over:
- e2e smoke: search → scan → teaser → **Firebase gate** (not WhatsApp/OTP). The gate can't be automated past reCAPTCHA; in CI, fake
  the token check (mock `verifyPhoneIdToken`) or use `auth.settings.appVerificationDisabledForTesting` with a test number.
- [x] CSP + security headers (2026-10-24): `src/lib/security-headers.ts`, applied in `next.config.ts` `headers()`. Allowlist CSP
  without nonces (nonces don't work with Cache Components / PPR); see SPEC.md section 14. Checked in Edge: landing (Turnstile,
  Places autocomplete), report (OSM tiles), gate (reCAPTCHA, Firebase) load with zero CSP violations; prod build has no
  `unsafe-eval`; HSTS from prod builds only. Tests: `tests/security-headers.test.ts`.
- [x] `/privacy` page (2026-10-24): operator The Sales Inc, contact grow@thesalesinc.com; linked from the landing page and the gate.
  Keep it in step with the code (it names Google, Cloudflare, Make.com, Google Cloud, OSM; redesigned in the brand theme with the logo 2026-10-25; retention 30 days / 90 days / leads kept).
- [ ] **Lead webhook to Make.com** (user task, 2026-10-24): after `/api/verify/confirm` stores a verified lead, POST it to a
  webhook URL the user will provide (`LEAD_WEBHOOK_URL`, server-only). Payload: phone E.164, country, role, scanId, business
  name/website, score, report URL. Send from the worker (queued job with retries), not inline in the request; set
  `crmSyncedAt` on success. The privacy page already lists Make.com.
- GCP VM: build args `NEXT_PUBLIC_GOOGLE_BROWSER_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_FIREBASE_*`,
  `NEXT_PUBLIC_PHONE_COUNTRIES`, `ONLINE_MODE` go to Cloud Build; `INTERNAL_APP_URL=http://web:3000` and `MOLI_URL` stay as in
  compose; custom domain `audit.thesalesinc.com` (already in Firebase authorized domains and the API key's referrers); real
  Turnstile keys are in `.env.railway` (gitignored, not loaded locally; the site key is copied to `.env.deploy`, the secret is in Secret Manager;
  secret verified with siteverify 2026-10-23). Widget mode Managed;
  the app renders it `interaction-only`. Localhost keeps the invisible test key `1x00000000000000000000BB`.
- Also in the brief: retention job, CI secret-leak check on values, autocannon load test, PostHog events, runbook, `getClientIp()`
  (prefers `X-Real-IP`, which Caddy must overwrite or clients can spoof it), metadata-server SSRF test, pino → Cloud Logging severity.
- Optional: real 404s via `proxy.ts`; reset the gate when the reCAPTCHA challenge is closed (`expired-callback` / timeout).

Live checks after deploy (Phase 5 acceptance):
- [x] Test number `+1 650-555-0100` / `123456`: gate → code → report unlocks (user, 2026-10-26; lead reached Make.com).
- [x] One real SMS to an Indian number; a wrong code shows the error copy (user, 2026-10-26).
- [ ] Autocomplete finds businesses in IN, US and GB without picking a country; a full scan of a non-Indian business (e.g. a
      London dentist) finishes with competitors, a NAP phone match and a score.
- [x] PDF downloads on the live site (user, 2026-10-26). reCAPTCHA challenge works in the pop-up.

## Decisions (SPEC.md section 13)
- Countries: **international** (decided 2026-10-23), done in Phase 5 task 0: worldwide search with no country picker (Google ranks
  by visitor IP), country from Place Details, international phone/NAP matching, global host lists, neutral labels. Not yet checked
  with a real key on a non-Indian business. `DEFAULT_COUNTRY` is only the phone gate's last-resort default.
- SMS countries (Firebase SMS region policy, mirrored in `.env` `NEXT_PUBLIC_PHONE_COUNTRIES`, synced 2026-10-23):
  AE AL AT AU AW BH BQ BS GB UN US CA IC IN IO. India is on. UN and IC aren't dialling regions (the gate hides them).
- Categories: 25 + "Something else" in `config/categories.json`; types checked against real Bengaluru results in Phase 3.
- Online-only mode: ships in v1 behind `ONLINE_MODE=on|off`.
- Phone verification: **Firebase Phone Auth (SMS)**, decided 2026-10-23; no WhatsApp. Report unlocks on the page + PDF download.
- Firebase (`tsi-project-cd47e`) is configured (2026-10-23); details in phases/phase-5.md "Firebase setup". Still the user's: a budget alert. Testing is live on `audit.thesalesinc.com` after deploy (no emulator).
- CRM: deferred by the user; leads stay in Postgres (`crmSyncedAt` null) for a later backfill.

## Waiting on the user
- [ ] Budget alert on the billing account (Google Cloud → Billing → Budgets & alerts; e.g. alerts at 30/50/90/100% of a monthly
      amount). Claude's read of the billing account was blocked.
- [ ] Confirm **IO** (British Indian Ocean Territory, +246) on the SMS list is intended; IN already covers India.
- [ ] Delete the empty `project/CLAUDE.md/` folder (Claude's delete was blocked).
- [ ] CRM choice, when ready.
- Google Places pricing: the Details/Nearby field masks bill at Enterprise tiers (SPEC.md section 1).

## Open housekeeping
- [ ] `/scan/[id]`, `/report/[id]` and `/report/[id]/print` return HTTP 200 for unknown ids, locked reports and a missing token (no
      data is sent). Optional `proxy.ts` in Phase 6.
- [ ] Gate button stays on "Sending…" if the visitor closes the reCAPTCHA challenge.
- [ ] Worker logs say `service: "web"` under plain `pnpm worker:dev` (SERVICE_NAME only set in compose and `pnpm start:app`). Minor.

## Environment notes (Windows + Podman)
- Use `podman compose` (Docker isn't installed). Podman VM: `podman machine start`.
- `pnpm start:app` does all of host dev in one terminal (services, migrate deploy, `dev` + `worker:dev`).
  Without the worker, scans stay `queued` with empty progress forever (no error anywhere).
- Backing services for host dev: `podman compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis moli`.
- The web container also binds :3000. Stop it (`podman compose stop web worker`) before `pnpm dev`.
- Stopping a background `pnpm dev` task can leave the Next child process running and holding the port.
  Kill project node processes in PowerShell:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like "*Business Report\project*" } | % { taskkill /PID $_.ProcessId /T /F }`
- Phone gate fails on `localhost` with `auth/invalid-app-credential` (firebase-js-sdk#8387), even for test numbers.
  Test it on `http://dev.thesalesinc.com:3000` (hosts file `127.0.0.1 dev.thesalesinc.com`; added to Firebase
  authorized domains + Firebase browser key referrers 2026-10-23; `allowedDevOrigins` in next.config.ts).
- `pnpm test` needs Redis on localhost:6379 (rate-limit tests use DB 15).
- Local `.env` uses Cloudflare's always-pass Turnstile test keys. Don't read `.env` (denied in settings); edit specific keys with sed.
- `NEXT_PUBLIC_*` and `ONLINE_MODE` are Docker build args (inlined into the client bundle). `DEFAULT_COUNTRY` no longer is (2026-10-23).
  After changing one in `.env`, restart `pnpm dev` (or rebuild the image).
- Firebase Auth settings (SMS regions, authorized domains, test numbers) aren't in the Firebase MCP tools; they were read and changed
  through the Identity Toolkit admin API (`identitytoolkit.googleapis.com/admin/v2/projects/tsi-project-cd47e/config`) with the
  Firebase CLI login (`firebase login`, account ishanchaudhary@thesalesinc.com, has the cloud-platform scope).
- `pnpm prisma migrate dev` refuses to run non-interactively: generate SQL with `prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --script`, save it as a migration folder, then `pnpm prisma migrate deploy`.
