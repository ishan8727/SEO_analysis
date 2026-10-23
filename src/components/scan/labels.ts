import type { Fix, Pillar, ProgressStep } from "@/types";

// User-facing names (SPEC.md section 9) and score colours shared by the scan and report pages.

export const STEP_LABELS: Record<ProgressStep, string> = {
  gbp: "Reading your Google profile",
  competitors: "Finding nearby competitors",
  psi: "Testing your website speed",
  dom: "Checking on-page SEO",
  sentiment: "Reading your reviews",
  finalize: "Calculating score",
};

export const PILLAR_LABELS: Record<Pillar, string> = {
  gbp: "Google profile",
  reputation: "Reviews & reputation",
  competitive: "Vs. nearby competitors",
  webTech: "Website speed & tech",
  onPage: "On-page SEO",
};

export const PILLARS_BY_MODE: Record<"local" | "online", Pillar[]> = {
  local: ["gbp", "reputation", "competitive", "webTech", "onPage"],
  online: ["webTech", "onPage"],
};

export const EFFORT_LABELS: Record<Fix["effort"], string> = { 1: "Quick fix", 2: "Some work", 3: "Bigger job" };

export type Tone = "good" | "ok" | "bad";

export function toneFor(score: number): Tone {
  if (score >= 70) return "good";
  if (score >= 40) return "ok";
  return "bad";
}

// Lighter shades on dark pages (the scan page) for AA contrast; the report and PDF stay light.
export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  ok: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

export const TONE_BG: Record<Tone, string> = {
  good: "bg-emerald-500",
  ok: "bg-amber-500",
  bad: "bg-red-500",
};

export const TONE_STROKE: Record<Tone, string> = {
  good: "stroke-emerald-500",
  ok: "stroke-amber-500",
  bad: "stroke-red-500",
};

/**
 * The same colours as SVG attributes. Moli (the PDF renderer) ignores CSS classes on SVG shapes
 * but honours attributes; browsers let the classes above win.
 */
export const TONE_HEX: Record<Tone, string> = { good: "#10b981", ok: "#f59e0b", bad: "#ef4444" };
export const MUTED_HEX = "#f5f5f5";
