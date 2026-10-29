# Phase 5 — Resize, deploy and live checks

**Goal:** the slim stack live on `audit.example.com`, with memory limits, runbook and VM size matching it.

This phase needs the user. Claude prepares the docs and commands; the user merges, deploys, resizes and deletes secrets.
`scripts/deploy.sh` only builds a clean `main` that matches `origin/main`, so the branch must be merged first.

## Builds on

Phases 1 to 4 on `reducing-the-version`: two containers (web with the jobs inside, postgres), about 0.9 GB reserved.

## Tasks

1. **Final limits and docs (Claude).**
   - `docker-compose.prod.yml`: final `mem_limit` values from the Phase 4 measurements.
   - `runbook.md` A6, A10 and section 6: this app now needs about 1 GB. `e2-small` (2 GB) fits it alone with the edge
     Caddy and the Ops Agent. Keep `e2-medium` while other apps share the host. Update the "seo-audit ≈ 2.4 GB" lines.
   - `phases/phase-6.md`: target-layout table without Redis and Moli; memory line and the rough monthly cost updated.
   - `runbook.md` section 2: a one-time "after the resize deploy" block (below).
2. **Merge and deploy (user).** Open a PR from `reducing-the-version` to `main`, review, merge. Then run
   `bash scripts/deploy.sh`. The first boot runs `prisma migrate deploy` (Phase 1 migration) and pg-boss creates the
   `pgboss` schema. Rollback is `bash scripts/deploy.sh <previous tag>`; note that the old image expects Redis and Moli,
   so a rollback needs the old compose files too (keep the previous commit's files at hand).
3. **Clean the VM once (user, on `shared-apps-1`).** `up -d --remove-orphans` in `vm-deploy.sh` stops the old `worker`,
   `redis` and `moli` containers. Then:
   ```bash
   sudo docker volume rm seo-audit_redis
   sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep '/seo-audit/moli:' | xargs -r sudo docker rmi
   ```
   Check `docker volume ls` first: the volume name is `<project>_redis`, so confirm it before removing.
4. **Secrets and registry (user).**
   - Delete `seo-audit-MOLI_TOKEN` and `seo-audit-INTERNAL_TOKEN` in Secret Manager.
   - Delete the `moli` images in Artifact Registry and apply the cleanup policy from Phase 4.
5. **Resize (user, optional).** Only if this is the only app on the host: stop the VM, `set-machine-type e2-small`, start
   (about 2 minutes of downtime; the IP stays). Commands in runbook A10. If other apps share the host, keep the size and
   enjoy the headroom.
6. **Live checks (user and Claude).**
   - A real scan of an Indian business and of a non-Indian one (e.g. a London dentist) finish with all steps, in the usual
     time.
   - The gate with the test number unlocks; one real SMS still works.
   - "Download PDF" prints from a phone and a laptop browser.
   - `/api/health` is green; the Cloud Monitoring uptime check stays green.
   - `docker stats` during a scan shows both containers under their limits.
   - Make.com receives the lead.
   - The nightly retention job runs (check the log line after 21:30 UTC).
7. **Close out (Claude).** `TODO.md`: Resize marked done with the measured memory, image size and machine type.
   `ResizePhases/README.md`: all phases ✅. `CLAUDE.md`: final commands and rules.

## Acceptance criteria

- The live site runs only `seo-audit-web-1` and `seo-audit-postgres-1` (plus the shared edge).
- All live checks above pass.
- Memory reserved by this app is about 0.9 GB, recorded in TODO.md.
- Secret Manager has no `MOLI_TOKEN` or `INTERNAL_TOKEN` for this app; no `moli` images remain in Artifact Registry.

**Prompt:** "Prepare ResizePhases/phase-5.md tasks 1 and 7 on branch reducing-the-version, and list for the user the exact
commands for tasks 2 to 6."
