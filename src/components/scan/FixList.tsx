import { Badge } from "@/components/ui/badge";
import type { Fix } from "@/types";
import { EFFORT_LABELS } from "./labels";

export function FixItem({ fix, index }: { fix: Fix; index: number }) {
  return (
    <li className="flex gap-3 rounded-lg border p-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
        {index + 1}
      </span>
      <div className="flex flex-1 flex-col gap-1.5">
        <p className="text-sm leading-snug">{fix.text}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">+{fix.pointsLost} pts</Badge>
          <Badge variant="outline">{EFFORT_LABELS[fix.effort]}</Badge>
        </div>
      </div>
    </li>
  );
}

export function FixList({ fixes, start = 0 }: { fixes: Fix[]; start?: number }) {
  return (
    <ol className="flex flex-col gap-2">
      {fixes.map((fix, i) => (
        <FixItem key={fix.key} fix={fix} index={start + i} />
      ))}
    </ol>
  );
}
