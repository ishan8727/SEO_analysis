"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// Full-screen loader for the live scan, in the site's sketch style: a hand-drawn magnifier sweeps over
// scribbled lines while a percentage climbs and a pencil-hatched bar fills. The counter climbs in random
// jumps that never pass the real `progress` and hits 100% only when `complete`; then a tick draws, the
// loader fades out and calls `onComplete`. The drawing animates in CSS (globals.css .loader-*); the counter
// and bar are written straight to the DOM a few times a second, so React doesn't re-render per tick.

const TICK_MS = 120;
const MIN_MS = 1800; // never reach 100% sooner, so the loader doesn't just flash
const SAFETY_MS = 120_000; // `complete` never came (stuck scan): get out of the way
const DONE_HOLD_MS = 700; // the tick draws
const FADE_MS = 400;
const INK = "#1f1b17";

type Phase = "loading" | "ready" | "fading" | "done";

export function SketchLoader({
  progress,
  complete = false,
  onComplete,
}: {
  /** Real progress, 0–1. */
  progress: number;
  /** What the loader waits for is finished: run to 100% and leave. */
  complete?: boolean;
  onComplete?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const counterRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  const trackRef = useRef({ progress, complete });

  useEffect(() => {
    onCompleteRef.current = onComplete;
    trackRef.current = { progress, complete };
  });

  useEffect(() => {
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const start = performance.now();
    let shown = 0;
    let nextJumpAt = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - start;
      // Random jumps up to the real progress (held just under 100% until complete).
      const done = trackRef.current.complete || elapsed > SAFETY_MS;
      const ceiling = Math.min(done ? 1 : Math.min(0.97, trackRef.current.progress), elapsed / MIN_MS);
      if (shown < ceiling && now >= nextJumpAt) {
        shown = Math.min(ceiling, shown + (done ? 0.05 : 0.01) + Math.random() * (done ? 0.08 : 0.03));
        nextJumpAt = now + (done ? 60 : 250 + Math.random() * 550);
      }
      const pct = Math.round(shown * 100);
      if (counterRef.current) counterRef.current.textContent = `${pct}%`;
      if (barRef.current) barRef.current.style.transform = `scaleX(${shown})`;

      if (shown >= 1) {
        clearInterval(interval);
        setPhase("ready");
        timers.push(setTimeout(() => setPhase("fading"), DONE_HOLD_MS));
        timers.push(
          setTimeout(() => {
            root.style.overflow = prevOverflow;
            setPhase("done");
            onCompleteRef.current?.();
          }, DONE_HOLD_MS + FADE_MS),
        );
      }
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
      root.style.overflow = prevOverflow;
    };
  }, []);

  if (phase === "done") return null;
  const ready = phase !== "loading";

  return (
    <div
      className="sketch-theme fixed inset-0 z-[100] flex items-center justify-center text-foreground transition-opacity ease-out"
      style={{ opacity: phase === "fading" ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      <div aria-hidden className="paper-bg absolute inset-0 -z-10" />
      <div role="status" className="flex flex-col items-center gap-4">
        <svg viewBox="0 0 260 150" aria-hidden className="w-56 overflow-visible">
          {/* Scribbled "text" lines being checked. */}
          {[30, 62, 94, 126].map((y, i) => (
            <path
              key={y}
              className="loader-line"
              style={{ "--d": `${i * 0.25}s` } as CSSProperties}
              pathLength={1}
              d={`M20 ${y} c 20 -6, 40 6, 60 0 s 40 -6, 60 0 s 40 6, 60 0 s 30 -4, ${40 - i * 12} 0`}
              fill="none"
              stroke={INK}
              strokeOpacity="0.35"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
          {ready ? (
            <path
              className="logo-draw"
              pathLength={1}
              d="M95 80 L 120 105 L 170 45"
              fill="none"
              stroke={INK}
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <g className="loader-lens">
              <circle cx="50" cy="40" r="26" fill="rgb(251 247 240 / 0.7)" stroke={INK} strokeWidth="8" />
              <path d="M36 34 C 38 27, 43 22, 50 21" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
              <path d="M70 60 L 92 82" stroke={INK} strokeWidth="11" strokeLinecap="round" />
            </g>
          )}
        </svg>
        <span className="font-[family-name:var(--font-hand)] text-lg font-bold text-muted-foreground">
          {ready ? "Done!" : "Checking your business…"}
        </span>
        <span ref={counterRef} aria-hidden className="font-[family-name:var(--font-hand)] text-5xl font-bold tabular-nums">
          0%
        </span>
        <div
          aria-hidden
          className="h-4 w-48 overflow-hidden border-2 border-foreground p-0.5"
          style={{ borderRadius: "10px 4px 12px 5px / 5px 12px 4px 10px" }}
        >
          <div
            ref={barRef}
            style={{ transform: "scaleX(0)" }}
            className="h-full origin-left bg-[repeating-linear-gradient(-55deg,#1f1b17_0_2px,transparent_2px_5px)] transition-transform duration-200"
          />
        </div>
      </div>
    </div>
  );
}
