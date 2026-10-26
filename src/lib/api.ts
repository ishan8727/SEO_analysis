import type { ApiErrorCode } from "@/types";

/** Typed JSON error, the only error shape API routes return: { error, code }. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  error: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error, code }, { status, headers });
}

/**
 * Client IP for rate limits. In production the only way in is the edge Caddy, which overwrites
 * X-Real-IP with the connecting address (deploy/seo-audit.caddy), so a client can't spoof it.
 * Fallback: the last X-Forwarded-For hop (the one a proxy appended; earlier hops are client-controlled).
 * If DNS is ever proxied through Cloudflare, use CF-Connecting-IP with Caddy trusted_proxies instead.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.at(-1) ?? "unknown";
}
