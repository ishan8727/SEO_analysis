import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { Grade } from "@/types";
import { TONE_STROKE, TONE_TEXT, toneFor } from "./labels";

const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Total score as a ring; a skeleton until the score exists. */
export function ScoreRing({ score, grade, className }: { score: number | null; grade: Grade | null; className?: string }) {
  if (score === null) {
    return <Skeleton className={cn("size-36 rounded-full", className)} aria-label="Score is being calculated" />;
  }
  const tone = toneFor(score);
  return (
    <div className={cn("relative size-36", className)} role="img" aria-label={`Score ${score} out of 100, grade ${grade}`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - score / 100)}
          className={cn("transition-[stroke-dashoffset] duration-700", TONE_STROKE[tone])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums">{score}</span>
        <span className={cn("text-sm font-medium", TONE_TEXT[tone])}>Grade {grade}</span>
      </div>
    </div>
  );
}
