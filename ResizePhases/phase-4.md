# Phase 4 — Dependency and image diet, Postgres tuning

**Goal:** smaller image, faster cold start, Postgres sized for this workload. No behaviour change.

## Builds on

Phase 3: two containers (web, postgres). The image still ships the full production `node_modules`, because
`migrate deploy` runs the `prisma` CLI at boot. That stays. The gains here come from dropping heavy packages.

## Tasks

1. **`firebase-admin` → `jose`.** `firebase-admin` is only used to verify the phone sign-in ID token, with no service
   account (`src/lib/firebase-admin.ts`).
   - `pnpm add jose`. Keep the file's exports: `MAX_SIGN_IN_AGE_SEC`, `VerifyError`, `checkPhoneClaims` (unchanged) and
     `verifyPhoneIdToken(idToken)`.
   - Verify with `createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"))`
     and `jwtVerify(idToken, jwks, { issuer: "https://securetoken.google.com/<projectId>", audience: projectId, algorithms: ["RS256"] })`.
     Create the JWKS once per process; jose caches the keys.
   - Also check what `verifyIdToken` checked: `sub` non-empty, `auth_time` present and not in the future, `iat` not in
     the future. Map any jose error to `VerifyError("invalid token: <code>")` as today.
   - Rename the file to `src/lib/firebase-token.ts` and update the import in `src/app/api/verify/confirm/route.ts`.
   - Tests: rewrite the "real firebase-admin rejects garbage and wrong-project tokens" case in
     `tests/verify-confirm.test.ts` (around line 125). Sign tokens with a throwaway key pair from jose and inject a local
     JWKS. Cover: garbage, wrong audience, wrong issuer, expired, non-phone provider, stale `auth_time` → 401.
   - Remove `firebase-admin` from `package.json` and `serverExternalPackages`.
2. **Small packages.**
   - `cn` → `clsx` + `tailwind-merge` in `src/lib/utils.ts` (the shadcn default). Point the 13 direct `from "cn"`
     imports at `@/lib/utils`. Check that class merging still behaves (variants in `button.tsx`, `badge.tsx`).
   - `shadcn` is a CLI: move it to `devDependencies`.
   - `dotenv` is only used by `prisma.config.ts`. Replace it with `process.loadEnvFile?.()` in a try/catch if Prisma
     loads the config under Node 22; otherwise keep it.
   - Run `pnpm why` on anything else large in the production install and note findings; remove only what is clearly
     unused.
3. **Image and registry.**
   - Record the app image size before (Phase 3 result) and after, in this file's Notes.
   - `runbook.md` Part B: an Artifact Registry cleanup policy that keeps the newest 5 tags of `app` (one
     `gcloud artifacts repositories set-cleanup-policies` command with a JSON policy file under `deploy/`). The user runs
     it in Phase 5.
   - `deploy/vm-deploy.sh`: after a healthy deploy, remove local `app` images other than the current and the previous
     tag (keeps one-step rollback).
4. **Postgres tuning** in `docker-compose.prod.yml`:
   - `command: ["postgres", "-c", "shared_buffers=32MB", "-c", "max_connections=40", "-c", "work_mem=4MB", "-c", "effective_cache_size=128MB"]`
   - `mem_limit: 256m`.
   - Count connections: Prisma's pool (`@prisma/adapter-pg` / `pg` Pool default) plus pg-boss `max` must stay well under
     40. Set the Prisma pool explicitly in `src/lib/db.ts` if it isn't (e.g. `max: 8`).
5. **Web limits** in `docker-compose.prod.yml`: keep `mem_limit: 640m` with `NODE_OPTIONS=--max-old-space-size=512`. If
   memory under three parallel scans (Phase 2 check) stayed well under 400 MB, lower to `512m` / `384` and note the
   numbers.

## Docs to update

- `architecture.md` section 3: the "Firebase Admin – token verification" row becomes "Google public signing keys,
  checked with jose".
- `SPEC.md`: token verification wording.
- `runbook.md`: cleanup policy, image pruning, Postgres settings, the measured memory.
- `TODO.md`: Resize status row and the measured image sizes.

## Acceptance criteria

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.
- The token tests above pass. On `http://dev.thesalesinc.com:3000` (TODO.md hosts-file setup), the gate with the Firebase
  test number `+1 650-555-0100` / `123456` still unlocks the report.
- `grep -rE "firebase-admin|from \"cn\"" src tests` finds nothing.
- Image size recorded, and smaller than after Phase 3.
- Container stack (ask first): Postgres starts with the new settings (`SHOW shared_buffers;` → 32MB), a full scan and an
  unlock work, and `podman stats` stays under the limits.

## Notes

- Image size before: _fill in_. After: _fill in_.

**Prompt:** "Implement ResizePhases/phase-4.md on branch reducing-the-version (rules in ResizePhases/README.md), then run
the acceptance checks and commit."
