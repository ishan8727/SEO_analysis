import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, getClientIp } from "@/lib/api";
import { enforceRateLimits } from "@/lib/rate-limit";
import { loadScanRow, SCAN_ID_RE, toLocked, toReport } from "@/lib/scan-view";
import { unlockCookieName, verifyUnlock } from "@/lib/unlock";

// GET /api/scans/:id — polled by the scan page. ScanLocked (status only, no results) until the
// visitor has verified their phone; ScanReport with a valid unlock cookie for this scan (SPEC.md section 9).

const paramsSchema = z.object({ id: z.string().regex(SCAN_ID_RE) });

export async function GET(req: NextRequest, ctx: RouteContext<"/api/scans/[id]">) {
  const limited = await enforceRateLimits([["scanStatusIp", getClientIp(req)]]);
  if (limited) return limited;

  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return apiError(404, "NOT_FOUND", "We couldn't find that audit.");
  const { id } = parsed.data;

  const row = await loadScanRow(id);
  if (!row) return apiError(404, "NOT_FOUND", "We couldn't find that audit.");

  const unlocked = verifyUnlock(req.cookies.get(unlockCookieName(id))?.value, id) !== null;
  return Response.json(unlocked ? toReport(row) : toLocked(row), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
