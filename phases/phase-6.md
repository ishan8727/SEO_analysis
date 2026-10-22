# Phase 6 — Hardening, tests, deploy

**Goal:** production-ready on Railway.

## Tasks

1. **Security headers**: strict CSP (self + maps.googleapis.com/maps.gstatic.com as the Maps SDK needs + tile.openstreetmap.org + challenges.cloudflare.com), X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, HSTS in prod. Check `node_modules/next/dist/docs/` for the Next 16 CSP guide (nonces via `proxy.ts`).
2. **Retention** (`src/worker/jobs/retention.ts`): register a nightly job scheduler from the worker; null `placeSnapshot` where `snapshotPurgeAt < now`; delete screenshot `Asset`s older than 90 days; keep scores, audits, leads.
3. **CI**: extend the secret-leak check to the actual key values (from CI secrets) as well as the names.
4. **e2e smoke** (Playwright against compose): search → scan → teaser → OTP → report. Use fake Google/WhatsApp providers in a test mode, so CI needs no real keys.
5. **Load test** `POST /api/scans` with autocannon; confirm 429s.
6. **PostHog events**: search_started, scan_created, scan_done, gate_shown, verified, report_viewed.
7. **Railway**: `railway.json` per service (web, worker, moli), health check `/api/health` on web, private networking, memory limits (worker ≈ 512 MB, moli ≈ 384 MB). No volumes needed: files live in `Asset`. Confirm which header carries the client IP behind Railway's proxy and tighten `getClientIp()`.
8. **README** runbook: rotate keys, purge data, replay a failed scan.
9. **Cleanup**: delete the empty `CLAUDE.md/` folder at the repo root and move `.claude/CLAUDE.md` there if you prefer.

## Acceptance criteria

- Lighthouse on the landing page ≥ 90 for performance and accessibility.
- e2e passes in CI; the production health check is green.
- A deliberately private URL (`http://10.0.0.1`) is rejected by the SSRF guard in prod.

**Prompt:** "Implement Phase 6 of SPEC.md from phases/phase-6.md, then produce a deployment checklist I can follow on Railway."
