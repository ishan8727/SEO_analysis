import { UnrecoverableError, type Job } from "bullmq";
import { env } from "@/lib/env";
import { analyzeReviews, reviewsForModel } from "@/lib/gemini";
import type { ScanJobData } from "@/lib/queue";
import { getRedis } from "@/lib/redis";
import { setStepState } from "@/lib/scan-progress";
import type { SentimentResult } from "@/types";
import { loadScan, saveBlob } from "@/worker/scan-context";

// Review sentiment via Gemini, cached per place for 30 days (Google content cache limit).
const CACHE_TTL_S = 30 * 24 * 60 * 60;

export async function sentimentJob(job: Job<ScanJobData>): Promise<void> {
  const { scanId } = job.data;
  const { snapshot } = await loadScan(scanId);
  if (!snapshot) throw new UnrecoverableError("Scan has no place snapshot");
  const reviews = reviewsForModel(snapshot.reviews);
  if (reviews.length === 0) {
    await setStepState(scanId, "sentiment", "skipped");
    return;
  }

  await setStepState(scanId, "sentiment", "running");
  const cacheKey = `sentiment:${snapshot.placeId}`;
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  let result: SentimentResult;
  if (cached) {
    result = JSON.parse(cached) as SentimentResult;
  } else {
    if (!env().GEMINI_API_KEY) throw new UnrecoverableError("GEMINI_API_KEY is not set");
    result = await analyzeReviews(reviews);
    await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_S);
  }
  await saveBlob(scanId, "sentiment", result);
  await setStepState(scanId, "sentiment", "done");
}
