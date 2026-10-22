import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/hash";

// Unlock cookie: HMAC-signed {scanId, leadId, exp}. Phase 5 sets it, Phase 4 reads it.

export const UNLOCK_TTL_SEC = 7 * 24 * 60 * 60;

export interface UnlockClaims {
  scanId: string;
  leadId: string;
  exp: number; // unix seconds
}

export function unlockCookieName(scanId: string): string {
  return `unlock_${scanId}`;
}

export function unlockCookieOptions() {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: UNLOCK_TTL_SEC,
  };
}

function sign(payload: string): string {
  return createHmac("sha256", env().COOKIE_SECRET).update(payload).digest("base64url");
}

export function signUnlock(scanId: string, leadId: string, nowMs = Date.now()): string {
  const claims: UnlockClaims = { scanId, leadId, exp: Math.floor(nowMs / 1000) + UNLOCK_TTL_SEC };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the claims if the token is authentic, unexpired and for this scan; otherwise null. */
export function verifyUnlock(
  token: string | undefined,
  scanId: string,
  nowMs = Date.now(),
): UnlockClaims | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as UnlockClaims;
    if (claims.scanId !== scanId || claims.exp * 1000 <= nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}
