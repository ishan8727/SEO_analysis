import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { Pillar } from "@/types";
import { PILLAR_LABELS, PILLARS_BY_MODE, TONE_BG, toneFor } from "./labels";

/** One bar per pillar of the mode; a pillar without a score yet shows a skeleton. */
export function PillarBars({ pillars, mode }: { pillars: Partial<Record<Pillar, number>>; mode: "local" | "online" }) {
  return (
    <ul className="flex w-full flex-col gap-3">
      {PILLARS_BY_MODE[mode].map((name) => {
        const value = pillars[name];
        return (
          <li key={name} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{PILLAR_LABELS[name]}</span>
              {value === undefined ? (
                <Skeleton className="h-4 w-8" />
              ) : (
                <span className="font-medium tabular-nums">{value}</span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              {value !== undefined && (
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700", TONE_BG[toneFor(value)])}
                  style={{ width: `${Math.max(2, value)}%` }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
