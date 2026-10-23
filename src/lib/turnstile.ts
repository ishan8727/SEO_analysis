import { env } from "@/lib/env";
import { log } from "@/lib/log";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Server-side Turnstile check. Fails closed: a missing secret, network error,
 * timeout or any non-success answer means "not verified".
 */
export async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string = env().TURNSTILE_SECRET,
): Promise<boolean> {
  if (!secret) {
    log.error("TURNSTILE_SECRET is not set; rejecting request");
    return false;
  }
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!data.success) log.info({ errors: data["error-codes"] }, "turnstile rejected");
    return data.success === true;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "turnstile verify failed");
    return false;
  }
}
