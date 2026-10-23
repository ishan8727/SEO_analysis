# Phase 6 — Hardening, tests, deploy

**Goal:** production-ready on **Google Cloud**: one Compute Engine VM running the compose stack, served at `audit.thesalesinc.com`.

Decided 2026-10-24 (user): GCP only, Railway dropped. One VM with compose (not Cloud Run), region **asia-south1 (Mumbai)**.

## Target layout

| Piece | Choice |
|---|---|
| GCP project | `tsi-project-cd47e` (already holds Firebase, the Maps/Places/PSI keys and billing) unless the user picks another |
| VM | Compute Engine `e2-medium` (2 shared vCPU, 4 GB), Debian 12, 30 GB balanced disk, zone `asia-south1-a`, static external IPv4. Move to `e2-standard-2` if scans are CPU-starved |
| Runtime | Docker Engine + compose plugin (not Podman). Base `docker-compose.yml` + new `docker-compose.prod.yml` |
| HTTPS | Caddy container on :80/:443, automatic Let's Encrypt cert, `reverse_proxy web:3000`. Only Caddy publishes ports |
| Images | Built by Cloud Build (`cloudbuild.yaml`), pushed to Artifact Registry `asia-south1-docker.pkg.dev/<project>/seo-audit/{app,moli}`. The VM only pulls; no builds on the VM |
| Postgres, Redis | Stay in compose on the VM's disk (named volumes). Redis with AOF on (`appendonly yes`), `noeviction` as now |
| Secrets | Secret Manager is the source of truth; a deploy script writes `/opt/seo-audit/.env` (owner root, mode 600) from it |
| Logs, metrics | Docker `gcplogs` logging driver → Cloud Logging; Ops Agent for memory/disk; Cloud Monitoring uptime check on `/api/health` with an email alert |
| Backups | Nightly `pg_dump` to a Cloud Storage bucket in asia-south1 (lifecycle: delete after 30 days) + daily disk snapshot schedule (keep 7) |
| DNS | `audit.thesalesinc.com` A record → the static IP, at whoever hosts thesalesinc.com DNS. If that's Cloudflare, use **DNS only** (grey cloud); proxied mode changes the client IP (see task 8) |

Rough cost: about $35–45/month (VM ~$25–30, disk, static IP, snapshots; logging within the free tier). Check current pricing.

## Tasks

1. ✅ **Security headers** (done 2026-10-24, allowlist CSP without nonces; see SPEC.md section 14).
2. ✅ **`/privacy` page** (done 2026-10-24). Now swap "Railway" for "Google Cloud (Compute Engine, Mumbai region)" as the host
   of the app and database.
3. **Production compose** (`docker-compose.prod.yml`): images from Artifact Registry (`${IMAGE_TAG}`), `restart: unless-stopped`
   on every service, memory limits (web ≈ 768 MB, worker ≈ 512 MB, moli ≈ 384 MB, postgres ≈ 512 MB, redis ≈ 192 MB; Docker on
   the VM honours them), web stops publishing :3000, a `caddy` service with `docker/caddy/Caddyfile` and volumes for its certs,
   `logging: driver: gcplogs` on app services. Redis `--appendonly yes`. `MOLI_URL=http://moli:9222` and
   `INTERNAL_APP_URL=http://web:3000` stay as in the base file. Postgres gets a real password from `.env`, not `app:app`.
4. **Caddyfile**: `audit.thesalesinc.com { reverse_proxy web:3000 { header_up X-Real-IP {remote_host} } }`, gzip/zstd, and a
   redirect from `www`/the bare IP if needed. HSTS already comes from Next.
5. **Cloud Build** (`cloudbuild.yaml`): build the app image with the build args (`NEXT_PUBLIC_GOOGLE_BROWSER_KEY`,
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_PHONE_COUNTRIES`, `ONLINE_MODE`) as substitutions, and
   the moli image; tag both with the git SHA and `latest`; push to Artifact Registry.
6. **Deploy script** (`scripts/deploy.sh`, run from a laptop with `gcloud`): `gcloud builds submit`, then over IAP SSH
   (`gcloud compute ssh --tunnel-through-iap`) refresh `.env` from Secret Manager, `docker compose pull`, `docker compose up -d`.
   Migrations keep running in web's start command (`prisma migrate deploy`). Rollback = rerun with the previous SHA.
7. **VM bootstrap** (`scripts/vm-bootstrap.sh`, documented in the runbook): install Docker + compose plugin, Ops Agent,
   `unattended-upgrades`, a 2 GB swap file; `gcloud auth configure-docker asia-south1-docker.pkg.dev`; the backup cron
   (`pg_dump | gzip | gcloud storage cp` to the bucket).
   - VM service account with only: Artifact Registry Reader, Secret Manager Secret Accessor, Logging Writer, Monitoring Metric
     Writer, Storage Object Creator on the backup bucket. Not the default compute SA with broad scopes.
   - Firewall: allow tcp:80,443 from anywhere; tcp:22 only from IAP (`35.235.240.0/20`). Nothing else.
8. **Client IP** (`getClientIp()` in `src/lib/api.ts`): it currently prefers `X-Real-IP`, which Caddy passes through from the
   client unless overwritten. Task 4's `header_up X-Real-IP {remote_host}` makes it trustworthy; add a test that a spoofed
   `X-Real-IP`/`X-Forwarded-For` from the client can't change the rate-limit key. If DNS is ever proxied through Cloudflare,
   switch to `CF-Connecting-IP` with Caddy `trusted_proxies` set to Cloudflare's ranges.
9. **Metadata server**: the worker runs on a GCE VM, so `169.254.169.254` / `metadata.google.internal` hand out the VM's
   service-account token. Add both to `tests/ssrf.test.ts` (the guard should already reject them: link-local range and the
   `internal` suffix) and confirm Moli's `--block-private-networks` blocks them from a rendered page.
10. **Logging**: map pino levels to Cloud Logging `severity` (pino `formatters.level`), so errors show as errors in Logs Explorer.
11. **Retention** (`src/worker/jobs/retention.ts`): register a nightly job scheduler from the worker; null `placeSnapshot` where
    `snapshotPurgeAt < now`; delete screenshot `Asset`s older than 90 days; keep scores, audits, leads.
12. **Lead webhook to Make.com** (see TODO.md): after `/api/verify/confirm` stores a verified lead, queue a worker job that POSTs
    it to `LEAD_WEBHOOK_URL` (server-only) with retries; set `crmSyncedAt` on success.
13. **CI**: extend the secret-leak check to the actual key values (from GitHub secrets) as well as the names.
14. **e2e smoke** (Playwright against compose): search → scan → teaser → Firebase gate → report. Fake Google providers in a test
    mode so CI needs no real keys; for the gate, mock `verifyPhoneIdToken` (reCAPTCHA can't be automated).
15. **Load test** `POST /api/scans` with autocannon against the VM; confirm 429s and that the VM stays responsive.
16. **PostHog events**: search_started, scan_created, scan_done, gate_shown, verified, report_viewed.
17. **Runbook** (README): deploy, roll back, rotate keys (Secret Manager → redeploy), restore a backup into a fresh VM, purge data,
    replay a failed scan, read logs, resize the VM.
18. **Cleanup**: replace Railway mentions in code comments (`Dockerfile`, `docker-compose.yml`, `src/lib/api.ts`,
    `src/app/api/health/route.ts`, `prisma/schema.prisma`, `docker/moli/start.sh`, `.env.example`); drop `railway.internal` from
    `DENIED_HOSTS` and its test (the `internal` suffix covers it); rename the user's `.env.railway` to `.env.production` and load
    its values into Secret Manager; delete the empty `CLAUDE.md/` folder at the repo root.
19. Optional: real 404s via `proxy.ts`; reset the gate when the reCAPTCHA challenge is closed.

## Acceptance criteria

- `https://audit.thesalesinc.com` serves the app with a valid certificate; `/api/health` is green; the uptime check passes.
- Only ports 80 and 443 answer from the internet (5432, 6379, 9222, 3000 closed).
- `sudo reboot` on the VM: every service comes back on its own and a new scan finishes.
- A backup restores into an empty Postgres and the restored scan pages render.
- A spoofed `X-Real-IP` doesn't bypass the rate limit; `http://10.0.0.1` and `http://169.254.169.254` are rejected by the SSRF guard.
- Lighthouse on the landing page ≥ 90 for performance and accessibility.
- e2e passes in CI.
- Phase 5 live checks pass on the live site (TODO.md: test number, real SMS, non-Indian scan, PDF download).

**Prompt:** "Implement Phase 6 of SPEC.md from phases/phase-6.md, then produce a deployment checklist I can follow on Google Cloud."
