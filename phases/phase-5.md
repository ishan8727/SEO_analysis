# Phase 5 — International pass, lead gate (Firebase phone auth), PDF

**Goal:** the tool works for businesses and visitors in any country. A visitor verifies their phone number with a Firebase SMS code to unlock the report on the page and downloads the PDF. The lead is stored for a later CRM push.

Changed on 2026-10-23:
- Firebase Phone Auth replaced the WhatsApp gate. Nothing is sent to the visitor after they verify: the report unlocks in the browser and has a "Download PDF" button.
- The product serves international clients, not only India. Task 0 removes the India-only assumptions from Phases 2–4.

See SPEC.md section 14.

## Why Firebase, and what it costs

- Firebase Phone Auth works in web browsers (`signInWithPhoneNumber` + `RecaptchaVerifier`). It needs the Blaze plan, which is on.
- Billed per SMS sent at Identity Platform rates, and the rate **depends on the destination country**: about $0.07 to India, $0.01 to the US, $0.04 to the UK, and some countries cost far more. The first 10 SMS per day are free. Check the rate card for each market you allow.
- Verifying the ID token on the server is free. `firebase-admin` needs only the project id.

## Builds on

- Phase 1: `Lead` model, `signUnlock()` + `unlockCookieOptions()`, `enqueuePdf()`, `withPage()`, `safeEqual()`, `RATE_LIMITS`, log redaction.
- Phase 2–3: `PlacesSearch`, `src/lib/google/places.ts`, `src/lib/page-audit.ts`, `config/categories.json`.
- Phase 4: the `gate` prop of `ScanLive` (src/components/scan/ScanLive.tsx), `ReportView` (it already shows "Download PDF" when `report.pdfUrl` is set), and the assets route (it already requires the unlock cookie for `pdf`).

## Firebase setup (done 2026-10-23, project `tsi-project-cd47e`)

- Blaze plan on; Phone sign-in on; web app "Local SEO Audit" registered; `.env` has the four Firebase keys and `NEXT_PUBLIC_PHONE_COUNTRIES`.
- SMS region policy: allow list AE AL AM AT AU AW BH BJ BQ BS BY GB UN US CA IC IN (the user's choice). `NEXT_PUBLIC_PHONE_COUNTRIES` mirrors it; change both together. This is the main protection against SMS pumping, because the browser asks Google to send the SMS directly and our rate limits can't stop it.
- Authorized domains: `audit.thesalesinc.com` (production), `www.thesalesinc.com`, the Firebase domains, `localhost`.
- Browser API key: referrers `https://audit.thesalesinc.com/*`, `https://www.thesalesinc.com/*`, the two Firebase domains, `http://localhost:3000/*`; APIs Identity Toolkit, Token Service, Installations, App Check, Firebase Management.
- Test numbers (no SMS, code `123456`): `+1 650-555-0100`, `+44 7700 900123`.
- Still the user's: a budget alert on the billing account (Billing → Budgets & alerts). Budgets only alert; they don't stop spending.
- Later, once traffic is real: lower the per-IP SMS quota, and turn on reCAPTCHA SMS defense / App Check.

## Testing approach (user decision 2026-10-23)

No emulator. Build to the official docs (https://firebase.google.com/docs/auth/web/phone-auth and https://firebase.google.com/docs/auth/admin/verify-id-tokens), cover the server side with unit tests (token checks mocked), and run the live end-to-end tests on `audit.thesalesinc.com` once the whole app is deployed. Firebase rejects `localhost` for phone auth, so the gate can't be exercised end to end locally.

## Tasks

0. **International pass (Phases 2–4 code). ✅ Done 2026-10-23, not committed.**
   - Business search is worldwide with **no country picker**: `PlacesSearch` no longer sends `includedRegionCodes`, so Google ranks results near the visitor by IP. The business's country comes from Google: Place Details now requests `addressComponents` and `internationalPhoneNumber` (both within the Enterprise tier we already pay), stored as `PlaceSnapshot.countryCode` / `internationalPhoneNumber` (optional; older snapshots lack them).
   - `regionCode=DEFAULT_COUNTRY` is gone from Details and Nearby Search. `DEFAULT_COUNTRY` is no longer a Docker build arg (the landing page doesn't read it); it stays a runtime env, the phone gate's last-resort default.
   - NAP: the phone match compares Google's national number (libphonenumber-js, with the place's country) against page numbers, allowing a country code / trunk prefix in front (`030/1234567`, `+49 (0)30 …`, `0044 20 …`). The trailing country is dropped from Google's address before the address match. Stopwords cover international legal forms (inc, llc, gmbh, pty, sarl, bv, …).
   - Ordering/booking host lists cover US, UK/EU, Middle East, APAC and Canada sites.
   - Category labels are neutral ("Accountant & tax", "Movers & removals", "Electronics & phones").
   - Tests: phone match for IN / US / GB / DE formats, a non-match, an old snapshot, the address without the country.
1. ✅ **Env + deps.** Add `firebase` (client) and `firebase-admin` (server). Add `firebase-admin` to `serverExternalPackages`.
   New env:
   - Public, also Docker build args like the other `NEXT_PUBLIC_*`: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and `NEXT_PUBLIC_PHONE_COUNTRIES` (comma-separated ISO codes, same list as the Firebase SMS region policy; empty = any).
   - Server: `FIREBASE_PROJECT_ID`.
   Remove `WHATSAPP_*` from `src/lib/env.ts` and `.env.example`. Remove `verifyStartIp` / `verifyStartPhone` from `RATE_LIMITS`, keep `verifyConfirmIp`, and add `verifyConfirmPhone` (e.g. 10/hour) keyed on the verified number.
2. ✅ **Schema migration.** Drop the `Verification` model (Firebase holds the code state now). On `Lead`: `channel` becomes `"firebase_sms"`, add `firebaseUid String?` and `countryCode String?`, and add `@@unique([scanId, phoneE164])` so a repeat unlock reuses the lead.
3. ✅ **`src/lib/firebase-admin.ts`** (server only): lazy `initializeApp({ projectId: FIREBASE_PROJECT_ID })`, plus `verifyPhoneIdToken(idToken)`. It calls `getAuth().verifyIdToken(idToken)`, then requires `firebase.sign_in_provider === "phone"`, a `phone_number` claim, and `auth_time` within the last 5 minutes. It returns `{ uid, phoneE164 }` or throws.
4. ✅ **`POST /api/verify/confirm`** `{ scanId, role, idToken }`: zod; rate limits `verifyConfirmIp`, then `verifyConfirmPhone` after the token is verified. Check that the scan exists. Parse `phone_number` with libphonenumber-js: it must be `isValid()`, and its country must be in `PHONE_COUNTRIES` when that list is set. Upsert `Lead { scanId, phoneE164, countryCode, role, channel: "firebase_sms", firebaseUid, verifiedAt: now }`.
   On success: set `unlock_<scanId>` via `signUnlock` + `unlockCookieOptions`, return `{ ok: true }`, and `enqueuePdf`. Errors: 400 `INVALID_INPUT`, 401 `{ code: "VERIFY_FAILED" }` for a bad, stale or non-phone token, 403 `{ code: "COUNTRY_NOT_SUPPORTED" }`, 404, 429.
5. ✅ **Gate card** (`src/components/scan/Gate.tsx`, passed as `ScanLive`'s `gate` prop):
   1. Role select. Phone input with a **country code select**, defaulting to the scanned business's `countryCode` (from Google), else `DEFAULT_COUNTRY`, and limited to `NEXT_PUBLIC_PHONE_COUNTRIES` when set. Add `countryCode` to the teaser payload for this. Format with libphonenumber-js `AsYouType`; the number must be `isValid()` before submitting.
   2. Consent line under the button: "We'll text you a code. By continuing you agree to our [privacy policy]." (GDPR/UK and similar laws apply to international leads.)
   3. "Send code": invisible `RecaptchaVerifier`, then `signInWithPhoneNumber(auth, e164, verifier)`. Set `auth.languageCode` from the browser so the SMS and reCAPTCHA are localised.
   4. 6-digit code input, then `confirmationResult.confirm(code)`, then `user.getIdToken()`, then POST `/api/verify/confirm`, then `signOut(auth)`, then refresh the scan (the report unlocks in place).
   - "Resend code" after 60 s. "Change number" goes back to step 1.
   - Map Firebase errors to owner-style copy: `auth/invalid-verification-code`, `auth/code-expired`, `auth/too-many-requests` (the 429 copy), `auth/invalid-phone-number`, `auth/quota-exceeded`, `auth/operation-not-allowed` (the region isn't allowed: "We can't text numbers in that country yet").
   - Load the Firebase SDK only inside the gate (dynamic import) so the landing page bundle doesn't grow.
6. ✅ **Print page + PDF** (screenshots left out of the PDF: Moli doesn't paint raster images; see TODO.md): `/report/[id]/print?token=INTERNAL_TOKEN` (`safeEqual`) renders `ReportView` in print layout with inlined CSS. **Moli runs with `--block-private-networks`, so it can't open `http://web:3000`.** Have the worker fetch the print HTML over the private network (add `INTERNAL_APP_URL`, e.g. `http://web:3000`), then `withPage(page => page.setContent(html) … page.pdf())` → `Asset` kind `pdf`. Confirm `setContent` + `pdf()` on Moli first with a small script.
   The job skips if the scan already has a `pdf` asset. Paper size: A4, or Letter for US/CA businesses. The report page polls `GET /api/scans/:id` until `pdfUrl` is set (show "Preparing your PDF…" until then).
7. **CRM: deferred** (user, 2026-10-23: "we'll configure it later"). Leads are stored in Postgres with `crmSyncedAt` null, so a later push can backfill them. No CRM code in this phase.
8. ✅ **Docs:** add the reCAPTCHA / Firebase domains to the CSP note in SPEC.md section 10 (www.google.com + www.gstatic.com scripts and frames, identitytoolkit.googleapis.com + securetoken.googleapis.com connect, the `authDomain` frame). Add a privacy policy page to Phase 6.

## Acceptance criteria

Local (before deploy):
- typecheck, lint, tests, `next build`, worker build pass.
- `/api/verify/confirm` unit tests (firebase-admin mocked): valid phone token → cookie + `Lead` (`channel = "firebase_sms"`, `countryCode`, `verifiedAt`) + PDF job; bad / stale / non-phone token → 401, no cookie; number outside `PHONE_COUNTRIES` → 403; same phone + scan twice → one `Lead`.
- The gate renders on `/scan/[id]` for a locked scan (role, country code, phone, consent), validates the number, and loads the Firebase SDK only when the gate mounts.
- PDF: the print page renders for a valid internal token and 404s without it; the worker produces a `pdf` Asset on Moli; the PDF downloads from the report with the cookie and returns 401 without it.
- A raw phone number or ID token never appears in logs (`idToken` in the pino redaction list).
- No server secret names in `.next/static`; the Firebase web config being there is expected (it's public).

Live, on `audit.thesalesinc.com` after the whole app is deployed (Phase 6):
- Test number `+1 650-555-0100` / `123456`: gate → code → report unlocks in place.
- One real SMS to an Indian number works end to end; a wrong code shows the error copy.
- Autocomplete finds businesses in IN, US and GB without picking a country; a full scan of a non-Indian business (e.g. a London dentist) finishes with competitors, a NAP phone match and a score.

**Prompt:** "Implement Phase 5 of SPEC.md from phases/phase-5.md (task 0 is done). Firebase Phone Auth in the browser per the official docs, ID token verified server-side with firebase-admin; no WhatsApp, no CRM yet."
