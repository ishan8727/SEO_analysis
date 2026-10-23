import { nanoid } from "nanoid";
import { Prisma } from "@/generated/prisma/client";
import { apiError, getClientIp } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPlaceDetails, PlacesError } from "@/lib/google/places";
import { hashIdentifier } from "@/lib/hash";
import { createScanSchema, siteOrigin, withScheme } from "@/lib/intake";
import { log } from "@/lib/log";
import { enqueueScan } from "@/lib/queue";
import { enforceRateLimits } from "@/lib/rate-limit";
import { markScanFailed } from "@/lib/scan-progress";
import { assertPublicUrl, SsrfError } from "@/lib/ssrf";
import { verifyTurnstile } from "@/lib/turnstile";
import type { PlaceSnapshot } from "@/types";

// POST /api/scans — create (or reuse) a scan. SPEC.md section 8.

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limited = await enforceRateLimits([
    ["scanCreateIpMinute", ip],
    ["scanCreateIpDay", ip],
  ]);
  if (limited) return limited;

  const parsed = createScanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "INVALID_INPUT", "Please check what you entered and try again.");
  const input = parsed.data;

  if (input.mode === "online" && env().ONLINE_MODE === "off") {
    return apiError(400, "INVALID_INPUT", "Website-only audits aren't available yet.");
  }

  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return apiError(403, "CAPTCHA_FAILED", "We couldn't verify you're human. Please try again.");
  }

  try {
    const ipHash = hashIdentifier(ip);
    return input.mode === "local"
      ? await createLocalScan(input.placeId, ipHash)
      : await createOnlineScan(input.url, ipHash);
  } catch (err) {
    log.error({ err: (err as Error).message, mode: input.mode }, "scan creation failed");
    return apiError(500, "SCAN_FAILED", "Something went wrong starting your audit. Please try again.");
  }
}

async function createLocalScan(placeId: string, ipHash: string): Promise<Response> {
  const existing = await db.business.findUnique({ where: { placeId }, select: { id: true } });
  const recent = existing && (await recentScanId(existing.id));
  if (recent) return Response.json({ scanId: recent });

  // Count only scans we actually create, so a cached result never trips the cap.
  const limited = await enforceRateLimits([["scanCreatePlaceDay", placeId]]);
  if (limited) return limited;

  let snapshot: PlaceSnapshot;
  try {
    snapshot = await getPlaceDetails(placeId);
  } catch (err) {
    if (err instanceof PlacesError && (err.status === 400 || err.status === 404)) {
      return apiError(400, "INVALID_INPUT", "We couldn't find that business on Google. Please pick it again.");
    }
    throw err;
  }

  const fields = {
    name: snapshot.name,
    websiteUrl: snapshot.websiteUri,
    address: snapshot.formattedAddress,
    lat: snapshot.location?.lat ?? null,
    lng: snapshot.location?.lng ?? null,
    primaryType: snapshot.primaryType,
  };
  const business = await db.business.upsert({
    where: { placeId },
    create: { placeId, mode: "local", ...fields },
    update: fields,
  });
  return Response.json({ scanId: await createScan(business.id, "local", ipHash, snapshot) });
}

async function createOnlineScan(rawUrl: string, ipHash: string): Promise<Response> {
  let url: URL;
  try {
    url = await assertPublicUrl(withScheme(rawUrl));
  } catch (err) {
    if (err instanceof SsrfError) return apiError(400, "INVALID_INPUT", "That website address can't be audited.");
    return apiError(400, "INVALID_INPUT", "We couldn't find that website. Check the address and try again.");
  }

  const origin = siteOrigin(url);
  const business =
    (await db.business.findFirst({ where: { mode: "online", websiteUrl: origin } })) ??
    (await db.business.create({ data: { mode: "online", name: url.hostname, websiteUrl: origin } }));

  const recent = await recentScanId(business.id);
  return Response.json({ scanId: recent ?? (await createScan(business.id, "online", ipHash, null)) });
}

/** A scan of this business newer than SCAN_CACHE_DAYS that hasn't failed, if any. */
async function recentScanId(businessId: string): Promise<string | null> {
  const since = new Date(Date.now() - env().SCAN_CACHE_DAYS * 24 * 60 * 60 * 1000);
  const scan = await db.scan.findFirst({
    where: { businessId, status: { not: "failed" }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return scan?.id ?? null;
}

async function createScan(
  businessId: string,
  mode: "local" | "online",
  ipHash: string,
  placeSnapshot: PlaceSnapshot | null,
): Promise<string> {
  const scan = await db.scan.create({
    data: {
      id: nanoid(21),
      businessId,
      ipHash,
      placeSnapshot: placeSnapshot ? (placeSnapshot as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
    },
  });
  try {
    await enqueueScan(scan.id, mode);
  } catch (err) {
    await markScanFailed(scan.id, "We couldn't start this audit. Please try again.");
    throw err;
  }
  return scan.id;
}
