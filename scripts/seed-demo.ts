// Dev only: inserts a demo scan with realistic blobs, so the scan and report pages can be
// built and checked without API keys or the worker.
//   pnpm seed:demo            a finished local scan
//   pnpm seed:demo --live     a local scan that this script walks through each step (~25 s)
//   pnpm seed:demo --online   a finished online-mode scan
// Prints the scan URL and an unlock cookie for the report page.
import { setTimeout as sleep } from "node:timers/promises";
import { nanoid } from "nanoid";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashIdentifier } from "@/lib/hash";
import { enqueuePdf, getScanQueue } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";
import { loadScanRow, scoreScan } from "@/lib/scan-view";
import { signUnlock, unlockCookieName } from "@/lib/unlock";
import type {
  CompetitorsResult,
  DomAuditResult,
  GbpResult,
  PlaceSnapshot,
  ProgressStep,
  PsiResult,
  SentimentResult,
} from "@/types";

const live = process.argv.includes("--live");
const online = process.argv.includes("--online");
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const HOME = { lat: 12.9719, lng: 77.6412 };

const snapshot: PlaceSnapshot = {
  placeId: "demo_sharma_dental_indiranagar",
  name: "Sharma Dental Care (demo)",
  formattedAddress: "12, 100 Feet Rd, Indiranagar, Bengaluru, Karnataka 560038, India",
  location: HOME,
  websiteUri: "https://sharmadental.example.in/",
  nationalPhoneNumber: "080 4123 4567",
  rating: 4.4,
  userRatingCount: 186,
  reviews: [
    { rating: 5, text: "Dr. Sharma explained every step of my root canal. Painless.", publishTime: daysAgo(12) },
    { rating: 5, text: "Clean clinic, friendly staff, fair prices.", publishTime: daysAgo(40) },
    { rating: 4, text: "Good treatment but I waited 30 minutes past my slot.", publishTime: daysAgo(75) },
    { rating: 2, text: "Booked online, nobody called back to confirm.", publishTime: daysAgo(120) },
    { rating: 5, text: "Best dentist in Indiranagar for kids.", publishTime: daysAgo(200) },
  ],
  weekdayHours: ["Monday: 10:00 AM – 8:00 PM", "Tuesday: 10:00 AM – 8:00 PM"],
  photosCount: 6,
  businessStatus: "OPERATIONAL",
  primaryType: "dentist",
  editorialSummary: null,
  googleMapsUri: null,
  fetchedAt: now.toISOString(),
};

const gbp: GbpResult = {
  checks: {
    hasWebsite: true,
    hasPhone: true,
    hasHours: true,
    hasDescription: false,
    photosCount: 6,
    isOperational: true,
    hasPrimaryType: true,
  },
  rating: 4.4,
  reviewCount: 186,
  newestReviewAt: daysAgo(12),
};

const competitor = (i: number, name: string, rating: number | null, reviewCount: number, dLat: number, dLng: number, distanceM: number) => ({
  placeId: `demo_competitor_${i}`,
  name,
  rating,
  reviewCount,
  location: { lat: HOME.lat + dLat, lng: HOME.lng + dLng },
  websiteUri: null,
  distanceM,
});

const competitors: CompetitorsResult = {
  radiusM: 3000,
  primaryType: "dentist",
  items: [
    competitor(1, "Smile Studio Indiranagar", 4.8, 640, 0.0065, -0.0004, 725),
    competitor(2, "City Dental Clinic", 4.5, 312, -0.0064, 0.0089, 1210),
    competitor(3, "Bright Teeth Dental", 4.2, 95, 0.011, 0.006, 1390),
    competitor(4, "Dr. Rao's Family Dentistry", 4.6, 58, -0.012, -0.007, 1540),
    competitor(5, "Indiranagar Dental Hub", 3.9, 41, 0.004, 0.015, 1700),
    competitor(6, "Pearl Dental Care", null, 0, -0.018, 0.002, 2010),
  ],
};

const strategy = (performance: number, lcpMs: number, tbtMs: number) => ({
  performance,
  seo: 0.83,
  bestPractices: 0.92,
  accessibility: 0.78,
  cwv: { lcpMs, cls: 0.04, inpMs: null, fcpMs: 1800, tbtMs },
  cwvPass: null,
  viewport: true,
  failingSeoAudits: [
    { id: "meta-description", title: "Document does not have a meta description" },
    { id: "image-alt", title: "Image elements do not have [alt] attributes" },
  ],
});

const psi: PsiResult = {
  url: "https://sharmadental.example.in/",
  https: true,
  mobile: strategy(0.41, 5200, 640),
  desktop: strategy(0.78, 1900, 120),
};

const domAudit: DomAuditResult = {
  renderer: "moli",
  finalUrl: "https://sharmadental.example.in/",
  httpStatus: 200,
  title: "Sharma Dental Care | Dentist in Indiranagar, Bengaluru",
  metaDescription: null,
  canonical: "https://sharmadental.example.in/",
  robotsMeta: null,
  viewport: true,
  h1Count: 1,
  h2Count: 5,
  jsonLdTypes: ["WebSite"],
  hasLocalSchema: false,
  ogTags: { "og:title": "Sharma Dental Care" },
  images: { total: 14, missingAlt: 9 },
  links: { internal: 18, external: 3, tel: 0, whatsapp: 1, maps: 1 },
  keywordHits: { ordering: false, booking: true },
  robotsTxt: true,
  sitemapXml: false,
  napMatch: online ? null : { name: 1, address: 0.6, phone: 1, score: 0.87 },
};

const sentiment: SentimentResult = {
  loves: ["Painless treatment", "Doctor explains clearly", "Good with children", "Clean clinic"],
  complaints: ["Waiting past appointment time", "Online bookings not confirmed"],
  positiveRatio: 0.8,
  summary: "Patients praise the gentle, clear treatment and the clean clinic; the main complaints are delays and unconfirmed online bookings.",
  reviewCount: 5,
};

/** A flat mock of a homepage, standing in for the PSI screenshot. */
function screenshotSvg(width: number, height: number): Buffer {
  const pad = Math.round(width * 0.06);
  const w = width - 2 * pad;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect width="100%" height="${Math.round(height * 0.09)}" fill="#0f766e"/>
  <text x="${pad}" y="${Math.round(height * 0.06)}" font-family="sans-serif" font-size="${Math.round(width * 0.035)}" fill="#fff">Sharma Dental Care</text>
  <rect x="${pad}" y="${Math.round(height * 0.15)}" width="${w}" height="${Math.round(height * 0.3)}" rx="12" fill="#ccfbf1"/>
  <rect x="${pad}" y="${Math.round(height * 0.5)}" width="${Math.round(w * 0.7)}" height="${Math.round(height * 0.03)}" rx="4" fill="#cbd5e1"/>
  <rect x="${pad}" y="${Math.round(height * 0.56)}" width="${Math.round(w * 0.9)}" height="${Math.round(height * 0.02)}" rx="4" fill="#e2e8f0"/>
  <rect x="${pad}" y="${Math.round(height * 0.6)}" width="${Math.round(w * 0.8)}" height="${Math.round(height * 0.02)}" rx="4" fill="#e2e8f0"/>
  <rect x="${pad}" y="${Math.round(height * 0.68)}" width="${Math.round(w * 0.35)}" height="${Math.round(height * 0.06)}" rx="8" fill="#0f766e"/>
</svg>`;
  return Buffer.from(svg);
}

async function saveScreenshots(scanId: string) {
  for (const [kind, bytes] of [
    ["screenshot_mobile", screenshotSvg(412, 823)],
    ["screenshot_desktop", screenshotSvg(1350, 940)],
  ] as const) {
    const data = { mime: "image/svg+xml", bytes: new Uint8Array(bytes) };
    await db.asset.upsert({ where: { scanId_kind: { scanId, kind } }, create: { scanId, kind, ...data }, update: data });
  }
}

const json = (v: object) => v as unknown as Prisma.InputJsonObject;

async function finalize(scanId: string) {
  const row = await loadScanRow(scanId);
  if (!row) throw new Error("scan vanished");
  await db.scan.update({
    where: { id: scanId },
    data: {
      score: json(scoreScan(row)),
      status: "done",
      finishedAt: new Date(),
      snapshotPurgeAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  await setStepState(scanId, "finalize", "done");
}

// ---------- main ----------

const business = online
  ? ((await db.business.findFirst({ where: { mode: "online", websiteUrl: "https://sharmadental.example.in" } })) ??
    (await db.business.create({ data: { mode: "online", name: "sharmadental.example.in", websiteUrl: "https://sharmadental.example.in" } })))
  : await db.business.upsert({
      where: { placeId: snapshot.placeId },
      create: {
        placeId: snapshot.placeId,
        mode: "local",
        name: snapshot.name,
        websiteUrl: snapshot.websiteUri,
        address: snapshot.formattedAddress,
        lat: HOME.lat,
        lng: HOME.lng,
        primaryType: "dentist",
      },
      update: {},
    });

const scanId = nanoid(21);
await db.scan.create({
  data: {
    id: scanId,
    businessId: business.id,
    ipHash: hashIdentifier("seed-demo"),
    placeSnapshot: online ? Prisma.DbNull : json(snapshot),
  },
});

const url = `${env().APP_URL}/scan/${scanId}`;
const token = signUnlock(scanId, "demo-lead");
console.log(`\nScan:   ${url}`);
console.log(`Report: ${env().APP_URL}/report/${scanId}`);
console.log(`\nUnlock (paste in the browser console on ${env().APP_URL}, valid 7 days):`);
console.log(`  document.cookie = "${unlockCookieName(scanId)}=${token}; path=/"`);
console.log(`curl:\n  curl -s ${env().APP_URL}/api/scans/${scanId} -b "${unlockCookieName(scanId)}=${token}"\n`);

const steps: [ProgressStep, () => Promise<unknown>][] = online
  ? [
      ["psi", async () => { await db.scan.update({ where: { id: scanId }, data: { psi: json(psi) } }); await saveScreenshots(scanId); }],
      ["dom", () => db.scan.update({ where: { id: scanId }, data: { domAudit: json(domAudit) } })],
    ]
  : [
      ["gbp", () => db.scan.update({ where: { id: scanId }, data: { gbp: json(gbp) } })],
      ["competitors", () => db.scan.update({ where: { id: scanId }, data: { competitors: json(competitors) } })],
      ["sentiment", () => db.scan.update({ where: { id: scanId }, data: { sentiment: json(sentiment) } })],
      ["dom", () => db.scan.update({ where: { id: scanId }, data: { domAudit: json(domAudit) } })],
      ["psi", async () => { await db.scan.update({ where: { id: scanId }, data: { psi: json(psi) } }); await saveScreenshots(scanId); }],
    ];

if (live) {
  console.log("Open the scan URL now; walking through the steps…");
  await sleep(5_000);
  for (const [step] of steps) await setStepState(scanId, step, "running");
  for (const [step, write] of steps) {
    await sleep(4_000);
    await write();
    await setStepState(scanId, step, "done");
    console.log(`  ${step} done`);
  }
  await setStepState(scanId, "finalize", "running");
  await sleep(1_500);
} else {
  for (const [step, write] of steps) {
    await write();
    await setStepState(scanId, step, "done");
  }
}
await finalize(scanId);
console.log("  scan done");

// Queue the PDF as a verified unlock would, so "Download PDF" appears (needs the worker running).
try {
  await enqueuePdf(scanId, "demo-lead");
  console.log("  PDF queued (made by the worker in a few seconds)");
} catch (err) {
  console.log(`  PDF not queued: ${(err as Error).message}`);
} finally {
  await getScanQueue().close();
}
await db.$disconnect();
process.exit(); // BullMQ leaves the Redis connection we hand it open
