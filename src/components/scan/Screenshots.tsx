import { Skeleton } from "@/components/ui/skeleton";
import type { ScanTeaser, StepState } from "@/types";

/**
 * PSI screenshots of the homepage. Skeletons while PSI runs; nothing when there is no
 * website to test. Plain <img>: the bytes come from our own asset route, already sized. Dimmed on
 * dark pages so a bright site doesn't glare; full brightness on hover.
 */
export function Screenshots({ shots, psiState }: { shots: ScanTeaser["screenshots"]; psiState: StepState }) {
  const waiting = psiState === "pending" || psiState === "running";
  if (!shots.mobile && !shots.desktop && !waiting) return null;
  return (
    <div className="grid grid-cols-[1fr_2.2fr] items-start gap-3">
      <figure className="flex flex-col gap-1.5">
        {shots.mobile ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shots.mobile} alt="Your homepage on a phone" className="w-full rounded-lg border transition-[filter] duration-300 dark:brightness-[0.8] dark:hover:brightness-100" />
        ) : (
          waiting && <Skeleton className="aspect-[9/16] w-full" />
        )}
        <figcaption className="text-xs text-muted-foreground">Phone</figcaption>
      </figure>
      <figure className="flex flex-col gap-1.5">
        {shots.desktop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shots.desktop} alt="Your homepage on a computer" className="w-full rounded-lg border transition-[filter] duration-300 dark:brightness-[0.8] dark:hover:brightness-100" />
        ) : (
          waiting && <Skeleton className="aspect-[16/10] w-full" />
        )}
        <figcaption className="text-xs text-muted-foreground">Computer</figcaption>
      </figure>
    </div>
  );
}
