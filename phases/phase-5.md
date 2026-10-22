# Phase 5 — Lead gate, WhatsApp, PDF, CRM

**Goal:** a visitor verifies their WhatsApp number to unlock the report, receives the report link + PDF, and the lead reaches the CRM.

## Builds on

- Phase 1: `Lead`/`Verification` models, `hashIdentifier()`, `safeEqual()`, `signUnlock()` + `unlockCookieOptions()`, `enqueuePdf()`, `withPage()`, `RATE_LIMITS.verify*`.
- Phase 4: the gate slot on `/scan/[id]`, `ReportView`, the assets route.

## Tasks

1. **`src/lib/otp.ts`**: 6-digit OTP (`crypto.randomInt`), 8-char uppercase inbound code (nanoid `customAlphabet`), stored as `hashIdentifier(code)`, 10 min / 30 min expiry, 5 attempts then locked 15 min, 60 s resend cooldown, constant-time compare.
2. **`src/lib/whatsapp/`**: `index.ts` interface `{ sendOtp(phone, code), sendReport(phone, text, link) }` chosen by `WHATSAPP_PROVIDER`; `meta.ts` (Cloud API, default) and `interakt.ts`.
3. **`POST /api/verify/start`** `{ scanId, phone, role, method?: "wa_inbound" | "wa_otp" }`: rate limits `verifyStartIp` + `verifyStartPhone`; phone via libphonenumber-js with `DEFAULT_COUNTRY`, must be `isValid()`, stored E.164; create `Lead` + `Verification`. Inbound → `{ method: "wa_inbound", waLink: "https://wa.me/<WHATSAPP_BUSINESS_NUMBER>?text=AUDIT%20<code>", code }`. OTP → send the auth template → `{ method: "wa_otp" }`.
4. **Webhook** `GET/POST /api/webhooks/whatsapp`: GET verify handshake; POST verifies `X-Hub-Signature-256` over the raw body with `WHATSAPP_APP_SECRET`, ignores replayed message ids (Redis `SET NX`, 24 h TTL), matches `AUDIT <code>` to an unconsumed inbound verification **whose lead phone equals the sender**, marks the lead verified, and replies with the report link (free inside the service window).
5. **`POST /api/verify/confirm`** `{ scanId, phone, code }`: OTP → checks the code; inbound → succeeds once the webhook has verified that lead (the gate polls this every 3 s after opening wa.me). This is how the browser gets its cookie, since the webhook can't set one. On success: set `unlock_<scanId>` via `signUnlock` + `unlockCookieOptions`, `{ ok: true }`, `enqueuePdf`.
6. **Gate card** on `/scan/[id]`: role select → phone → "Verify on WhatsApp" + "Send me a code instead".
7. **Print page + PDF**: `/report/[id]/print?token=INTERNAL_TOKEN` (`safeEqual`) renders `ReportView` in print layout with inlined CSS. **Moli runs with `--block-private-networks`, so it can't open `http://web:3000`.** Have the worker fetch the print HTML over the private network (add `INTERNAL_APP_URL`, e.g. `http://web:3000`), then `withPage(page => page.setContent(html) … page.pdf())` → `Asset` kind `pdf` → `sendReport`. Confirm `setContent` + `pdf()` on Moli first with a small script.
8. **`src/lib/crm.ts`**: Zoho Bigin push (name, phone, role, business, score, report link) behind `CRM_ENABLED=false`; set `Lead.crmSyncedAt`.

## Acceptance criteria

- The full inbound flow works end to end on a test number; the OTP fallback works.
- The 6th wrong OTP attempt locks.
- The webhook rejects a bad signature and ignores a replayed message id.
- The PDF opens and matches the report.
- A raw phone number never appears in logs.

**Prompt:** "Implement Phase 5 of SPEC.md from phases/phase-5.md. Keep provider code behind the interface; default to Meta Cloud API."
