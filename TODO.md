# TODO — build tracker

Read this first in a new session, then SPEC.md and the brief for the current phase in `phases/`.
Build phases **one at a time, in order**. Stop after each phase and show the user how to verify it.

## Status

| Phase | Brief | Status |
|---|---|---|
| 1 Setup and infrastructure | phases/phase-1.md | ✅ Done, committed (`a7051d4`) |
| 2 Intake | phases/phase-2.md | 🟡 Code done, verified locally, committed (`b57b306`); a few checks left (see below) |
| 3 Audit engine | phases/phase-3.md | 🟡 Code done, verified against fixtures; real-key run left (see below). Not committed |
| 4 Scoring, report, live scan page | phases/phase-4.md | ⬜ Not started |
| 5 Lead gate, WhatsApp, PDF, CRM | phases/phase-5.md | ⬜ Not started |
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

- [ ] Real scan with keys: set `GOOGLE_SERVER_KEY`, `PSI_API_KEY` (may equal the server key) and `GEMINI_API_KEY`, run
      `pnpm worker:dev` + `pnpm scan:run <placeId>`. Check: all five blobs filled, two screenshot assets, < 60 s,
      and `competitors.items` never contains the scanned place id. (Keyless PSI returns 429, so PSI can't be tested without a key.)
- [ ] Kill Moli for real mid-scan (`podman compose stop moli` while `dom` is running) and confirm `renderer: "fallback"`.
      Verified so far by pointing the worker at a dead `MOLI_URL`, which hits the same catch path. Ask before stopping containers.
- [ ] Check the Places primary types in `config/categories.json` against real Nearby Search results.

### Phase 3 verified so far (host worker, `pnpm scan:run`)
- Fixture place + example.com: gbp `done`, dom `done` via Moli (rendered DOM, JS-injected content included);
  competitors/psi/sentiment `failed` fast (missing keys → UnrecoverableError, no retries); scan reaches `done`.
- Fixture place without a website: psi + dom `skipped`, blobs null, scan `done`.
- Online mode (haldirams.com): dom via Moli in ~7 s; with `MOLI_URL` dead → `renderer: "fallback"`, same facts, 1.6 s.
- typecheck, lint, 84 tests, `next build`, worker build pass; no server key names or PSI/Places calls in `.next/static`.

### Phase 3 notes for Phase 4
- A website on a denied host (e.g. a facebook.com page) is treated as no website: psi/dom `skipped`, but
  `gbp.checks.hasWebsite` is still true. Decide how the fix list words this.
- A step can end `failed` (e.g. site down, DNS failure) with a null blob; score it like a missing blob.
- `domAudit.napMatch`: a part Google has no data for reads 0 and is left out of `score` (see src/types.ts).
- dom audit: if robots.txt disallows our UA (or `*`) for the page, the step is `skipped`.
- DOM extraction runs cheerio over Moli's rendered `outerHTML` (one extractor for both renderers) instead of
  a separate `page.evaluate` per field.

## Decisions waiting on the user (SPEC.md section 13)
Phase 2 used these defaults; change them if the user answers differently:
- Countries: India only (`DEFAULT_COUNTRY=IN`).
- Categories: 25 + "Something else" in `config/categories.json` (types unverified against Google until a key exists).
- Online-only mode: ships in v1 behind `ONLINE_MODE=on|off`.
- WhatsApp provider (Meta vs Interakt) and CRM (Zoho Bigin assumed): needed before Phase 5.
- Google Places pricing: the Details/Nearby field masks bill at Enterprise tiers (SPEC.md section 1).

## Open housekeeping
- [ ] The user should delete the empty `project/CLAUDE.md/` folder (deleting it was blocked); project instructions live in `.claude/CLAUDE.md`.
- [ ] Phase 4: `/scan/[id]` currently returns HTTP 200 for unknown ids (notFound() inside a streamed Suspense boundary). Fine for the placeholder; handle it when Phase 4 replaces the page.
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
- `NEXT_PUBLIC_*`, `DEFAULT_COUNTRY` and `ONLINE_MODE` are Docker build args (inlined into the static landing page).
