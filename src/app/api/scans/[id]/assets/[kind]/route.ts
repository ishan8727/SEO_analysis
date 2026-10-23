import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, getClientIp } from "@/lib/api";
import { db } from "@/lib/db";
import { enforceRateLimits } from "@/lib/rate-limit";
import { SCAN_ID_RE } from "@/lib/scan-view";
import { unlockCookieName, verifyUnlock } from "@/lib/unlock";
import { ASSET_KINDS } from "@/types";

// GET /api/scans/:id/assets/:kind — screenshot or PDF bytes from the Asset table.
// Screenshots are part of the teaser; the PDF needs the unlock cookie.

const paramsSchema = z.object({ id: z.string().regex(SCAN_ID_RE), kind: z.enum(ASSET_KINDS) });

export async function GET(req: NextRequest, ctx: RouteContext<"/api/scans/[id]/assets/[kind]">) {
  const limited = await enforceRateLimits([["assetIp", getClientIp(req)]]);
  if (limited) return limited;

  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return apiError(404, "NOT_FOUND", "File not found.");
  const { id, kind } = parsed.data;

  if (kind === "pdf" && !verifyUnlock(req.cookies.get(unlockCookieName(id))?.value, id)) {
    return apiError(401, "UNAUTHORIZED", "Verify your number to download the report.");
  }

  const asset = await db.asset.findUnique({
    where: { scanId_kind: { scanId: id, kind } },
    select: { mime: true, bytes: true },
  });
  if (!asset) return apiError(404, "NOT_FOUND", "File not found.");

  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(asset.bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ...(kind === "pdf" && { "Content-Disposition": `attachment; filename="seo-audit-${id}.pdf"` }),
    },
  });
}
