import { cookies } from "next/headers";
import { z } from "zod";
import { apiError, getClientIp } from "@/lib/api";
import { db } from "@/lib/db";
import { verifyPhoneIdToken, VerifyError } from "@/lib/firebase-admin";
import { log } from "@/lib/log";
import { allowedPhoneCountries, isAllowedPhoneCountry, parsePhone } from "@/lib/phone";
import { enqueuePdf } from "@/lib/queue";
import { enforceRateLimits } from "@/lib/rate-limit";
import { SCAN_ID_RE } from "@/lib/scan-view";
import { signUnlock, unlockCookieName, unlockCookieOptions } from "@/lib/unlock";

// POST /api/verify/confirm — trade a Firebase phone-auth ID token for the unlock cookie. SPEC.md section 8.
// The browser did the SMS round trip with Firebase; we trust only the verified token's phone number.

const bodySchema = z.object({
  scanId: z.string().regex(SCAN_ID_RE),
  role: z.enum(["owner", "founder", "marketing", "agency", "other"]),
  idToken: z.string().min(100).max(8_192),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limited = await enforceRateLimits([["verifyConfirmIp", ip]]);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "INVALID_INPUT", "Please check what you entered and try again.");
  const { scanId, role, idToken } = parsed.data;

  const scan = await db.scan.findUnique({ where: { id: scanId }, select: { id: true } });
  if (!scan) return apiError(404, "NOT_FOUND", "We couldn't find that audit.");

  let verified: { uid: string; phoneE164: string };
  try {
    verified = await verifyPhoneIdToken(idToken);
  } catch (err) {
    if (err instanceof VerifyError) {
      log.warn({ scanId, reason: err.message }, "phone verification rejected");
      return apiError(401, "VERIFY_FAILED", "We couldn't verify your number. Please try again.");
    }
    log.error({ scanId, err: (err as Error).message }, "phone verification failed");
    return apiError(500, "INTERNAL", "Something went wrong. Please try again in a few minutes.");
  }

  const phoneLimited = await enforceRateLimits([["verifyConfirmPhone", verified.phoneE164]]);
  if (phoneLimited) return phoneLimited;

  const phone = parsePhone(verified.phoneE164);
  if (!phone) return apiError(400, "INVALID_INPUT", "That phone number doesn't look right.");
  if (!isAllowedPhoneCountry(phone.country, allowedPhoneCountries())) {
    return apiError(403, "COUNTRY_NOT_SUPPORTED", "We can't verify numbers from that country yet.");
  }

  const now = new Date();
  const lead = await db.lead.upsert({
    where: { scanId_phoneE164: { scanId, phoneE164: phone.e164 } },
    create: {
      scanId,
      phoneE164: phone.e164,
      countryCode: phone.country ?? null,
      role,
      channel: "firebase_sms",
      firebaseUid: verified.uid,
      verifiedAt: now,
    },
    update: { role, firebaseUid: verified.uid, verifiedAt: now },
    select: { id: true },
  });

  (await cookies()).set(unlockCookieName(scanId), signUnlock(scanId, lead.id), unlockCookieOptions());
  await enqueuePdf(scanId, lead.id).catch((err: Error) =>
    log.error({ scanId, err: err.message }, "pdf enqueue failed"), // the unlock still stands
  );
  log.info({ scanId, leadId: lead.id, country: phone.country }, "lead verified");
  return Response.json({ ok: true });
}
