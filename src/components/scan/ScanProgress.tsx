import { cn } from "cn";
import { Check, Circle, LoaderCircle, Minus, X } from "lucide-react";
import { STEPS_BY_MODE, type ProgressStep, type ScanProgress as Progress, type StepState } from "@/types";
import { STEP_LABELS } from "./labels";

const STATE_TEXT: Record<StepState, string> = {
  pending: "Waiting",
  running: "Working…",
  done: "Done",
  failed: "Couldn't check",
  skipped: "Not needed",
};

function StepIcon({ state }: { state: StepState }) {
  const base = "size-5 shrink-0";
  switch (state) {
    case "running":
      return <LoaderCircle className={cn(base, "animate-spin text-foreground")} aria-hidden />;
    case "done":
      return <Check className={cn(base, "text-emerald-600")} aria-hidden />;
    case "failed":
      return <X className={cn(base, "text-red-600")} aria-hidden />;
    case "skipped":
      return <Minus className={cn(base, "text-muted-foreground")} aria-hidden />;
    default:
      return <Circle className={cn(base, "text-muted-foreground/50")} aria-hidden />;
  }
}

/** Stepper over the mode's steps plus "Calculating score". */
export function ScanProgress({
  mode,
  progress,
  status,
}: {
  mode: "local" | "online";
  progress: Progress;
  status: "queued" | "running" | "done" | "failed";
}) {
  const steps: ProgressStep[] = [...STEPS_BY_MODE[mode], "finalize"];
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Audit progress">
      {steps.map((step) => {
        // finalize flips status to done just before it marks its own step done.
        const state: StepState = step === "finalize" && status === "done" ? "done" : (progress[step] ?? "pending");
        return (
          <li key={step} className="flex items-center gap-3 text-sm">
            <StepIcon state={state} />
            <span className={cn("flex-1", state === "pending" && "text-muted-foreground")}>{STEP_LABELS[step]}</span>
            <span className="text-xs text-muted-foreground">{STATE_TEXT[state]}</span>
          </li>
        );
      })}
    </ol>
  );
}
