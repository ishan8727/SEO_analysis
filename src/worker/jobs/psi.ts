import { UnrecoverableError, type Job } from "bullmq";
import { env } from "@/lib/env";
import { runPsi } from "@/lib/google/psi";
import { log } from "@/lib/log";
import type { ScanJobData } from "@/lib/queue";
import { setStepState } from "@/lib/scan-progress";
import type { PsiResult } from "@/types";
import { auditableUrl, loadScan, saveAsset, saveBlob } from "@/worker/scan-context";

// PageSpeed Insights, mobile and desktop in parallel. One failing strategy leaves its half null.
export async function psiJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  const { websiteUrl } = await loadScan(scanId);
  const url = websiteUrl && (await auditableUrl(scanId, websiteUrl));
  if (!url) {
    await setStepState(scanId, "psi", "skipped");
    return;
  }
  if (!env().PSI_API_KEY && !env().GOOGLE_SERVER_KEY) throw new UnrecoverableError("PSI_API_KEY is not set");

  await setStepState(scanId, "psi", "running");
  const [mobile, desktop] = await Promise.allSettled([runPsi(url, "mobile"), runPsi(url, "desktop")]);
  if (mobile.status === "rejected" && desktop.status === "rejected") throw mobile.reason;
  for (const [strategy, run] of [["mobile", mobile], ["desktop", desktop]] as const) {
    if (run.status === "rejected") log.warn({ scanId, strategy, err: (run.reason as Error).message }, "psi strategy failed");
  }

  const runs = { mobile: mobile.status === "fulfilled" ? mobile.value : null, desktop: desktop.status === "fulfilled" ? desktop.value : null };
  if (runs.mobile?.screenshot) await saveAsset(scanId, "screenshot_mobile", runs.mobile.screenshot.mime, runs.mobile.screenshot.bytes);
  if (runs.desktop?.screenshot) await saveAsset(scanId, "screenshot_desktop", runs.desktop.screenshot.mime, runs.desktop.screenshot.bytes);

  const finalUrl = runs.mobile?.finalUrl ?? runs.desktop?.finalUrl ?? url;
  const result: PsiResult = {
    url,
    https: finalUrl.startsWith("https:"),
    mobile: runs.mobile?.result ?? null,
    desktop: runs.desktop?.result ?? null,
  };
  await saveBlob(scanId, "psi", result);
  await setStepState(scanId, "psi", "done");
}
