import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { assertPublicUrl, SsrfError } from "@/lib/ssrf";
import type { AssetKind, PlaceSnapshot } from "@/types";

// What an audit job needs to know about its scan, and how it stores results.

export interface ScanContext {
  scanId: string;
  mode: "local" | "online";
  websiteUrl: string | null;
  snapshot: PlaceSnapshot | null; // local mode only
}

export async function loadScan(scanId: string): Promise<ScanContext> {
  const scan = await db.scan.findUniqueOrThrow({
    where: { id: scanId },
    select: { placeSnapshot: true, business: { select: { mode: true, websiteUrl: true } } },
  });
  return {
    scanId,
    mode: scan.business.mode,
    websiteUrl: scan.business.websiteUrl,
    snapshot: scan.placeSnapshot as unknown as PlaceSnapshot | null,
  };
}

type BlobColumn = "gbp" | "competitors" | "psi" | "domAudit" | "sentiment";

/** Writes one audit blob. Each job owns its own column, so parallel jobs never clash. */
export async function saveBlob(scanId: string, column: BlobColumn, value: object): Promise<void> {
  await db.scan.update({ where: { id: scanId }, data: { [column]: value as Prisma.InputJsonObject } });
}

export async function saveAsset(scanId: string, kind: AssetKind, mime: string, bytes: Buffer): Promise<void> {
  const data = { mime, bytes: new Uint8Array(bytes) };
  await db.asset.upsert({
    where: { scanId_kind: { scanId, kind } },
    create: { scanId, kind, ...data },
    update: data,
  });
}

/**
 * The scan's website if we may audit it. A denied host (e.g. a Facebook page listed as the
 * website) counts as no website; other errors (DNS failures) throw so the job retries.
 */
export async function auditableUrl(scanId: string, websiteUrl: string): Promise<string | null> {
  try {
    return (await assertPublicUrl(websiteUrl)).toString();
  } catch (err) {
    if (!(err instanceof SsrfError)) throw err;
    log.info({ scanId, reason: err.reason }, "website can't be audited; treating as no website");
    return null;
  }
}
