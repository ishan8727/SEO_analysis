import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { PILLAR_LABELS, PILLARS_BY_MODE } from "./labels";

/**
 * A blurred, non-interactive stand-in for a locked section. Children must be placeholder
 * content only: the real data is never sent to a visitor who hasn't verified. With `onUnlock`
 * the label is a button (it opens the verification pop-up).
 */
export function Locked({
  label,
  children,
  onUnlock,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onUnlock?: () => void;
  className?: string; // on the lock pill
}) {
  const pill = `flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium shadow-sm ${className}`;
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div aria-hidden className="pointer-events-none select-none blur-sm">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/40">
        {onUnlock ? (
          <button
            type="button"
            onClick={onUnlock}
            className={`${pill} cursor-pointer transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
          >
            <Lock className="size-3.5" aria-hidden />
            {label}
          </button>
        ) : (
          <span className={pill}>
            <Lock className="size-3.5" aria-hidden />
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/** Grey bars standing in for text in a locked section. */
export function PlaceholderLines({ rows, className = "" }: { rows: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
          <div className="size-6 shrink-0 rounded-full bg-muted" />
          <div className="h-3 flex-1 rounded bg-muted" style={{ maxWidth: `${85 - ((i * 17) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Stand-in for the score ring and pillar bars: fixed shapes, no numbers. On the locked wall
 * (`animated`) the ring and bars fill once, like a score landing (globals.css .wall-ring/.wall-bar).
 */
export function PlaceholderScore({ mode, animated = false }: { mode: "local" | "online"; animated?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      <svg viewBox="0 0 120 120" className="size-36 shrink-0 -rotate-90">
        <circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset="32"
          className={`stroke-foreground/30 ${animated ? "wall-ring" : ""}`}
        />
      </svg>
      <ul className="flex w-full flex-col gap-3">
        {PILLARS_BY_MODE[mode].map((name, i) => (
          <li key={name} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{PILLAR_LABELS[name]}</span>
              <span className="h-4 w-8 rounded bg-muted" />
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full bg-foreground/25 ${animated ? "wall-bar" : ""}`}
                style={{ width: `${70 - ((i * 23) % 45)}%`, ["--wall-i" as string]: i }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
