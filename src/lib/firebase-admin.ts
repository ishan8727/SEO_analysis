import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { env } from "@/lib/env";

// Server-side check of the Firebase ID token the gate gets after phone sign-in.
// verifyIdToken() checks signature, aud (our project), iss, exp, iat and sub; it needs only the
// project id, no service account (https://firebase.google.com/docs/auth/admin/verify-id-tokens).

/** The sign-in must be this fresh: the token is exchanged for an unlock cookie right after the code. */
export const MAX_SIGN_IN_AGE_SEC = 5 * 60;

const APP_NAME = "phone-auth";

/** The token is not a fresh, valid phone sign-in for our project. */
export class VerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyError";
  }
}

function adminAuth() {
  const { FIREBASE_PROJECT_ID } = env();
  if (!FIREBASE_PROJECT_ID) throw new Error("FIREBASE_PROJECT_ID is not set");
  const app = getApps().find((a) => a.name === APP_NAME) ?? initializeApp({ projectId: FIREBASE_PROJECT_ID }, APP_NAME);
  return getAuth(app);
}

/** The claims we rely on, after verifyIdToken() accepted the token. */
export function checkPhoneClaims(
  token: Pick<DecodedIdToken, "uid" | "auth_time" | "phone_number" | "firebase">,
  nowMs = Date.now(),
): { uid: string; phoneE164: string } {
  if (token.firebase?.sign_in_provider !== "phone" || !token.phone_number) {
    throw new VerifyError("not a phone sign-in");
  }
  if (nowMs / 1000 - token.auth_time > MAX_SIGN_IN_AGE_SEC) throw new VerifyError("sign-in too old");
  return { uid: token.uid, phoneE164: token.phone_number };
}

export async function verifyPhoneIdToken(idToken: string): Promise<{ uid: string; phoneE164: string }> {
  const auth = adminAuth(); // a missing project id is a config error, not a bad token
  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (err) {
    throw new VerifyError(`invalid token: ${(err as { code?: string }).code ?? "unknown"}`);
  }
  return checkPhoneClaims(decoded);
}
