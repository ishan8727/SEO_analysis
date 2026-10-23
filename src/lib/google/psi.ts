import { z } from "zod";
import { env } from "@/lib/env";
import type { PsiStrategyResult } from "@/types";

// PageSpeed Insights v5 (Lighthouse run by Google). Server-side only.

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_CATEGORIES = ["performance", "seo", "best-practices", "accessibility"];
/** PSI routinely takes 20–60 s; each strategy gets its own budget. */
export const PSI_TIMEOUT_MS = 50_000;

export type PsiStrategy = "mobile" | "desktop";

export class PsiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PsiError";
  }
}

const auditSchema = z.object({
  title: z.string().optional(),
  score: z.number().nullable().optional(),
  scoreDisplayMode: z.string().optional(),
  numericValue: z.number().optional(),
  details: z.object({ data: z.string().optional() }).optional(),
});

const categorySchema = z.object({
  score: z.number().nullable().optional(),
  auditRefs: z.array(z.object({ id: z.string() })).optional(),
});

const fieldMetricSchema = z.object({ percentile: z.number().optional(), category: z.string().optional() });

const psiSchema = z.object({
  loadingExperience: z
    .object({
      overall_category: z.string().optional(),
      metrics: z.record(z.string(), fieldMetricSchema).optional(),
    })
    .optional(),
  lighthouseResult: z.object({
    finalDisplayedUrl: z.string().optional(),
    finalUrl: z.string().optional(),
    categories: z.record(z.string(), categorySchema),
    audits: z.record(z.string(), auditSchema),
  }),
});

export interface PsiRun {
  result: PsiStrategyResult;
  finalUrl: string | null;
  screenshot: { mime: string; bytes: Buffer } | null; // Lighthouse "final-screenshot"
}

const SKIPPED_MODES = new Set(["notApplicable", "manual", "informative", "error"]);

/** Pure: maps a PSI response to what we store. */
export function parsePsi(raw: unknown): PsiRun {
  const { loadingExperience: field, lighthouseResult: lh } = psiSchema.parse(raw);
  const category = (id: string) => lh.categories[id]?.score ?? null;
  const numeric = (id: string) => lh.audits[id]?.numericValue ?? null;
  const passed = (id: string) => lh.audits[id]?.score === 1;

  const failingSeoAudits = (lh.categories.seo?.auditRefs ?? []).flatMap(({ id }) => {
    const audit = lh.audits[id];
    if (!audit || audit.score == null || audit.score >= 1) return [];
    if (audit.scoreDisplayMode && SKIPPED_MODES.has(audit.scoreDisplayMode)) return [];
    return [{ id, title: audit.title ?? id }];
  });

  const shot = lh.audits["final-screenshot"]?.details?.data?.match(/^data:(image\/[a-z+]+);base64,(.+)$/);

  return {
    result: {
      performance: category("performance"),
      seo: category("seo"),
      bestPractices: category("best-practices"),
      accessibility: category("accessibility"),
      cwv: {
        lcpMs: numeric("largest-contentful-paint"),
        cls: numeric("cumulative-layout-shift"),
        inpMs: field?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        fcpMs: numeric("first-contentful-paint"),
        tbtMs: numeric("total-blocking-time"),
      },
      cwvPass: field?.overall_category ? field.overall_category === "FAST" : null,
      // Lighthouse 13 folded "viewport" into "viewport-insight".
      viewport: passed("viewport") || passed("viewport-insight"),
      failingSeoAudits,
    },
    finalUrl: lh.finalDisplayedUrl ?? lh.finalUrl ?? null,
    screenshot: shot ? { mime: shot[1], bytes: Buffer.from(shot[2], "base64") } : null,
  };
}

export function psiRequestUrl(url: string, strategy: PsiStrategy, key: string): string {
  const params = new URLSearchParams({ url, strategy });
  for (const c of PSI_CATEGORIES) params.append("category", c);
  if (key) params.set("key", key);
  return `${PSI_URL}?${params}`;
}

export async function runPsi(url: string, strategy: PsiStrategy): Promise<PsiRun> {
  const { PSI_API_KEY, GOOGLE_SERVER_KEY } = env();
  const res = await fetch(psiRequestUrl(url, strategy, PSI_API_KEY || GOOGLE_SERVER_KEY), {
    signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Never echo the request URL: it carries the key.
    const body = (await res.json().catch(() => null)) as { error?: { status?: string } } | null;
    throw new PsiError(res.status, `PSI ${strategy} failed: ${res.status} ${body?.error?.status ?? ""}`.trim());
  }
  return parsePsi(await res.json());
}
