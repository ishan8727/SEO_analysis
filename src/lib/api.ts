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
 * Client IP behind Railway's proxy. Prefers X-Real-IP, else the last X-Forwarded-For hop
 * (the one our proxy appended; earlier hops are client-controlled).
 * Phase 6: confirm which header Railway sets and tighten this if needed.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.at(-1) ?? "unknown";
}
