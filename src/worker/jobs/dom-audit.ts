import type { Job } from "bullmq";
import { withPage } from "@/lib/browser";
import { log } from "@/lib/log";
import { extractPage, napMatch, robotsAllows, robotsSitemaps } from "@/lib/page-audit";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";
import { safeFetch } from "@/lib/ssrf";
import type { DomAuditResult } from "@/types";
import { auditableUrl, loadScan, saveBlob } from "@/worker/scan-context";

// On-page SEO audit. Renders with Moli; on any Moli error, fetches the raw HTML instead.

/** Shorter than withPage()'s default so the fallback still fits in the scan's 60 s budget. */
const MOLI_TIMEOUT_MS = 25_000;
const SIDE_FETCH_TIMEOUT_MS = 8_000;

interface RenderedPage {
  renderer: DomAuditResult["renderer"];
  finalUrl: string;
  httpStatus: number | null;
  html: string;
}

export async function domAuditJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  const { websiteUrl, snapshot } = await loadScan(scanId);
  const url = websiteUrl && (await auditableUrl(scanId, websiteUrl));
  if (!url) {
    await setStepState(scanId, "dom", "skipped");
    return;
  }

  await setStepState(scanId, "dom", "running");
  const target = new URL(url);
  const robotsTxt = await fetchRobotsTxt(target.origin);
  if (!robotsAllows(robotsTxt, target.pathname + target.search)) {
    log.info({ scanId }, "dom audit skipped: robots.txt disallows us");
    await setStepState(scanId, "dom", "skipped");
    return;
  }

  const [page, sitemapXml] = await Promise.all([
    renderWithMoli(url).catch((err: Error) => {
      log.warn({ scanId, err: err.message }, "moli failed; using fetch fallback");
      return fetchFallback(url);
    }),
    hasSitemap(target.origin, robotsTxt),
  ]);

  const { facts, text } = extractPage(page.html, page.finalUrl);
  const result: DomAuditResult = {
    renderer: page.renderer,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    ...facts,
    robotsTxt: robotsTxt !== null,
    sitemapXml,
    napMatch: snapshot ? napMatch(text, snapshot) : null,
  };
  await saveBlob(scanId, "domAudit", result);
  await setStepState(scanId, "dom", "done");
}

async function renderWithMoli(url: string): Promise<RenderedPage> {
  return withPage(async (page) => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // Give client-rendered sites a moment; fine if "load" never comes.
    await page.waitForLoadState("load", { timeout: 4_000 }).catch(() => {});
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    return { renderer: "moli", finalUrl: page.url(), httpStatus: response?.status() ?? null, html };
  }, MOLI_TIMEOUT_MS);
}

async function fetchFallback(url: string): Promise<RenderedPage> {
  const res = await safeFetch(url);
  return { renderer: "fallback", finalUrl: res.url, httpStatus: res.status, html: res.body.toString("utf8") };
}

/** robots.txt body, or null when the site has none (soft-404 HTML pages count as none). */
async function fetchRobotsTxt(origin: string): Promise<string | null> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: SIDE_FETCH_TIMEOUT_MS, maxBytes: 512 * 1024 });
    const body = res.body.toString("utf8");
    return res.status === 200 && !/<html/i.test(body) ? body : null;
  } catch {
    return null;
  }
}

async function hasSitemap(origin: string, robotsTxt: string | null): Promise<boolean> {
  if (robotsSitemaps(robotsTxt).length > 0) return true;
  try {
    const res = await safeFetch(`${origin}/sitemap.xml`, { timeoutMs: SIDE_FETCH_TIMEOUT_MS });
    return res.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(res.body.toString("utf8"));
  } catch {
    return false;
  }
}
