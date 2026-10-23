import { UnrecoverableError, type Job } from "bullmq";
import { withPage } from "@/lib/browser";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { inlineForPrint, INTERNAL_TOKEN_HEADER, type Fetchers } from "@/lib/print-html";
import type { PdfJobData } from "@/lib/queue";
import { loadScan, saveAsset } from "@/worker/scan-context";

// Report PDF, queued by /api/verify/confirm. Fetches the print page from the web app over the
// private network (INTERNAL_APP_URL), inlines its CSS and fonts, and prints it on Moli with
// setContent() — Moli blocks private networks, so it can't load the page itself.

const FETCH_TIMEOUT_MS = 20_000;
const LETTER_COUNTRIES = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE"]);

async function get(url: string, headers?: Record<string, string>): Promise<Response> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${new URL(url).pathname} → ${res.status}`);
  return res;
}

const fetchers: Fetchers = {
  text: async (url) => (await get(url)).text(),
  bytes: async (url) => {
    const res = await get(url);
    return { mime: res.headers.get("content-type") ?? "application/octet-stream", data: Buffer.from(await res.arrayBuffer()) };
  },
};

export async function pdfJob(job: Job<PdfJobData>): Promise<void> {
  const { scanId } = job.data;
  const existing = await db.asset.findUnique({ where: { scanId_kind: { scanId, kind: "pdf" } }, select: { id: true } });
  if (existing) return; // one PDF per scan; a second verified lead reuses it

  const { INTERNAL_APP_URL, INTERNAL_TOKEN } = env();
  if (!INTERNAL_TOKEN) throw new UnrecoverableError("INTERNAL_TOKEN is not set");

  // The token goes in a header, not the URL, so request logs never see it.
  const page = await get(`${INTERNAL_APP_URL}/report/${scanId}/print`, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
  const html = await inlineForPrint(await page.text(), INTERNAL_APP_URL, fetchers);

  const { snapshot } = await loadScan(scanId);
  const format = LETTER_COUNTRIES.has(snapshot?.countryCode ?? "") ? "Letter" : "A4";
  const pdf = await withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    return page.pdf({ format, printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } });
  });

  await saveAsset(scanId, "pdf", "application/pdf", Buffer.from(pdf));
  log.info({ scanId, bytes: pdf.byteLength, format }, "pdf saved");
}
