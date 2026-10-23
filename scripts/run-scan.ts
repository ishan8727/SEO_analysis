// Dev only: creates a scan directly (no Turnstile, no rate limits), waits for the worker,
// then prints every blob. Needs the worker running (`pnpm worker:dev`).
//   pnpm scan:run <placeId>                      local mode, Place Details from Google
//   pnpm scan:run <path/to/place-details.json>   local mode from a saved Place Details response
//   pnpm scan:run <https://site.example>         online mode
import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlaceDetails, toPlaceSnapshot } from "@/lib/google/places";
import { hashIdentifier } from "@/lib/hash";
import { PLACE_ID_RE, siteOrigin, withScheme } from "@/lib/intake";
import { enqueueScan, getScanQueue } from "@/lib/queue";
import { assertPublicUrl } from "@/lib/ssrf";
import type { PlaceSnapshot } from "@/types";

const WAIT_MS = 150_000;
const arg = process.argv[2];
if (!arg) {
  console.error("usage: pnpm scan:run <placeId | place-details.json | url>");
  process.exit(1);
}

async function createBusiness(): Promise<{ businessId: string; mode: "local" | "online"; snapshot: PlaceSnapshot | null }> {
  if (arg.endsWith(".json") || PLACE_ID_RE.test(arg)) {
    const snapshot = arg.endsWith(".json")
      ? toPlaceSnapshot(JSON.parse(await readFile(arg, "utf8")))
      : await getPlaceDetails(arg);
    const fields = {
      name: snapshot.name,
      websiteUrl: snapshot.websiteUri,
      address: snapshot.formattedAddress,
      lat: snapshot.location?.lat ?? null,
      lng: snapshot.location?.lng ?? null,
      primaryType: snapshot.primaryType,
    };
    const business = await db.business.upsert({
      where: { placeId: snapshot.placeId },
      create: { placeId: snapshot.placeId, mode: "local", ...fields },
      update: fields,
    });
    return { businessId: business.id, mode: "local", snapshot };
  }
  const url = await assertPublicUrl(withScheme(arg));
  const origin = siteOrigin(url);
  const business =
    (await db.business.findFirst({ where: { mode: "online", websiteUrl: origin } })) ??
    (await db.business.create({ data: { mode: "online", name: url.hostname, websiteUrl: origin } }));
  return { businessId: business.id, mode: "online", snapshot: null };
}

const { businessId, mode, snapshot } = await createBusiness();
const scan = await db.scan.create({
  data: {
    id: nanoid(21),
    businessId,
    ipHash: hashIdentifier("run-scan-cli"),
    placeSnapshot: snapshot ? (snapshot as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
  },
});
const started = Date.now();
await enqueueScan(scan.id, mode);
console.log(`scan ${scan.id} (${mode}) enqueued, waiting for the worker...`);

let lastProgress = "";
let current = scan;
while (Date.now() - started < WAIT_MS) {
  current = await db.scan.findUniqueOrThrow({ where: { id: scan.id } });
  const progress = JSON.stringify(current.progress);
  if (progress !== lastProgress) {
    console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s ${current.status} ${progress}`);
    lastProgress = progress;
  }
  if (current.status === "done" || current.status === "failed") break;
  await new Promise((r) => setTimeout(r, 500));
}

const assets = await db.asset.findMany({
  where: { scanId: scan.id },
  select: { kind: true, mime: true, bytes: true },
});
const { gbp, competitors, psi, domAudit, sentiment, score, error } = current;
console.log(
  JSON.stringify(
    {
      scanId: scan.id,
      status: current.status,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      error,
      gbp,
      competitors,
      psi,
      domAudit,
      sentiment,
      score,
      assets: assets.map((a) => ({ kind: a.kind, mime: a.mime, bytes: a.bytes.byteLength })),
    },
    null,
    2,
  ),
);
if (current.status !== "done") process.exitCode = 1;
await getScanQueue().close();
await db.$disconnect();
process.exit();
