import { cn } from "@/lib/utils";

// Three pulsing ink dots for busy buttons and waits. CSS only: .ink-dot
// in globals.css; takes the text colour.
export function DotsLoader({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="ink-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}
