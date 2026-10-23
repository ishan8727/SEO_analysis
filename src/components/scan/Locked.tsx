import { Lock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A blurred, non-interactive stand-in for a locked section. Children must be placeholder
 * content only: the real data is never sent to a locked visitor.
 */
export function Locked({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div aria-hidden className="pointer-events-none select-none blur-sm">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/40">
        <span className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium shadow-sm">
          <Lock className="size-3.5" aria-hidden />
          {label}
        </span>
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
