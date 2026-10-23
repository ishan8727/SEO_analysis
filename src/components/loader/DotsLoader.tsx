import { cn } from "@/lib/utils";

// Three pulsing dots (the loader's " ·•●" motif) for busy buttons and waits. CSS only: .brand-dot
// in globals.css; takes the text colour.
export function DotsLoader({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="brand-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}
