"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useMediaQuery, usePageVisible } from "@/components/landing/media-hooks";
import { AsciiArt } from "@/components/ui/ascii-art";

// Animated ASCII background for the landing page: brand-red arrows rising up-right over black, with a
// sparse white sparkle layer on top. Source frames come from `pnpm ascii:frames`. Each layer has two
// AsciiArt instances that take turns: the hidden one converts the next frame, then they crossfade, so
// a new frame never pops in half-drawn. Motion styles (drift, pulse, overlay) live in globals.css.

const FRAMES = [1, 2, 3, 4].map((n) => `/ascii/bg-frame-${n}.svg`);
const FRAME_MS = 900;
const FADE_MS = 300; // matches duration-300 on the slots
const INTRO_MS = 3000; // AsciiArt's matrix reveal on first load
const RED = "#FB2B2F";
// Brightness → glyph, dark to bright. Half the range is ↗ so strokes read as arrows: the "arrows"
// preset tops out at ↙, the opposite of the motif.
const ARROW_CHARS = " ·-/↗↗↗↗";

// Which frame each of the two slots shows, and which slot is in front.
function useFrameCycle(running: boolean) {
  const [cycle, setCycle] = useState({ front: 0, frames: [0, 1] });
  const introDone = useRef(false);

  useEffect(() => {
    if (!running) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    let refill: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      setCycle((c) => ({ ...c, front: 1 - c.front }));
      // Once the old front has faded out, load it with the frame after the new front's.
      refill = setTimeout(() => {
        setCycle((c) => {
          const frames = [...c.frames];
          frames[1 - c.front] = (frames[c.front] + 1) % FRAMES.length;
          return { ...c, frames };
        });
      }, FADE_MS + 50);
    };

    const start = setTimeout(
      () => {
        introDone.current = true;
        tick();
        interval = setInterval(tick, FRAME_MS);
      },
      introDone.current ? FRAME_MS : INTRO_MS,
    );
    return () => {
      clearTimeout(start);
      clearTimeout(refill);
      clearInterval(interval);
    };
  }, [running]);

  return cycle;
}

// Moves an element up to 10px toward the cursor, eased.
function useParallax(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const target = { x: 0, y: 0 };
    const pos = { x: 0, y: 0 };
    let frame = 0;

    const step = () => {
      pos.x += (target.x - pos.x) * 0.08;
      pos.y += (target.y - pos.y) * 0.08;
      el.style.transform = `translate3d(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px, 0)`;
      const settled = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) < 0.05;
      frame = settled ? 0 : requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 20;
      target.y = (e.clientY / window.innerHeight - 0.5) * 20;
      if (!frame) frame = requestAnimationFrame(step);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      el.style.transform = "";
    };
  }, [enabled]);

  return ref;
}

interface SlotProps {
  src: string;
  resolution: number;
  charset: string;
  color: string;
  intro: "matrix" | "fade" | null; // AsciiArt's own animation, played once on first load
}

// Memoised so a frame swap only re-renders the slot whose src changed.
const Slot = memo(function Slot({ src, resolution, charset, color, intro }: SlotProps) {
  return (
    <AsciiArt
      src={src}
      resolution={resolution}
      charset={charset}
      color={color}
      objectFit="cover"
      animated={intro !== null}
      animationStyle={intro ?? "none"}
      animationDuration={intro === "fade" ? 1.2 : undefined} // matrix keeps its 3s default (INTRO_MS)
      animateOnView={false}
      className="absolute inset-0 h-full w-full"
    />
  );
});

export function SalesAsciiBackground() {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const desktop = useMediaQuery("(min-width: 1024px)", true);
  const tablet = useMediaQuery("(min-width: 640px)", true);
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const visible = usePageVisible();
  const moving = !reducedMotion;
  const cycle = useFrameCycle(moving && visible);
  const parallaxRef = useParallax(moving && finePointer);

  // The art box is at least 1.2× as wide as it is tall (see below), so on phones it is wider than the
  // screen: these keep the characters about the same size on every device (~13px).
  const resolution = desktop ? 120 : tablet ? 100 : 80;

  useEffect(() => {
    for (const src of FRAMES) new Image().src = src; // warm the cache for the cycle
  }, []);

  function slots(layer: "arrows" | "sparkle") {
    const look =
      layer === "arrows"
        ? { resolution, charset: ARROW_CHARS, color: RED }
        : { resolution: Math.round(resolution * 0.6), charset: "dots", color: "#ffffff" };
    if (!moving) return <Slot src={FRAMES[0]} {...look} intro={null} />;
    return [0, 1].map((i) => (
      <div
        key={i}
        className="absolute inset-0 transition-opacity duration-300 ease-linear"
        style={{ opacity: cycle.front === i ? 1 : 0 }}
      >
        <Slot
          src={FRAMES[cycle.frames[i]]}
          {...look}
          intro={i === 0 ? (layer === "arrows" ? "matrix" : "fade") : null}
        />
      </div>
    ));
  }

  return (
    <div
      aria-hidden
      data-paused={visible ? undefined : ""}
      className="ascii-bg pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black"
    >
      {/* Never narrower than 1.2× its height, so character cells stay roughly square on phones. Pinned
          left: on a phone the box is wider than the screen, and the art is brightest bottom-left. */}
      <div className="absolute inset-y-0 left-0 w-[max(100%,120vh)]">
        <div className="ascii-drift-arrows absolute -inset-[3%]">
          <div className="ascii-pulse absolute inset-0 opacity-60">{slots("arrows")}</div>
        </div>
        {/* Blend mode on the outer box: an inner one would only blend inside the parallax layer. */}
        <div ref={parallaxRef} className="absolute inset-0 mix-blend-screen">
          <div className="ascii-drift-sparkle absolute -inset-[3%] scale-110 opacity-20">{slots("sparkle")}</div>
        </div>
      </div>
      <div className="ascii-bg-overlay absolute inset-0" />
    </div>
  );
}
