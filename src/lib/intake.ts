import { z } from "zod";
import { MAX_URL_LENGTH } from "@/lib/ssrf";

// Input contract for POST /api/scans (SPEC.md section 8).

export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

const turnstileToken = z.string().min(1).max(2048);

export const createScanSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local"), placeId: z.string().regex(PLACE_ID_RE), turnstileToken }),
  z.object({ mode: z.literal("online"), url: z.string().trim().min(1).max(MAX_URL_LENGTH), turnstileToken }),
]);

export type CreateScanInput = z.infer<typeof createScanSchema>;

/** People type "mysite.in"; add https:// when no scheme was given. */
export function withScheme(raw: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** One Business per website in online mode, keyed by scheme + lowercase host. */
export function siteOrigin(url: URL): string {
  return `${url.protocol}//${url.hostname.toLowerCase()}`;
}
