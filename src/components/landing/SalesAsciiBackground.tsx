"use client";

import { useEffect, useRef, useState } from "react";
import { ASCII_FRAMES } from "@/components/landing/ascii-frames";
import { useMediaQuery } from "@/components/landing/media-hooks";
import { AsciiArt } from "@/components/ui/ascii-art";

// Still ASCII background: one frame of brand-red arrows over black, with a sparse white dot layer.
// It renders dim and settles to its resting opacity once `active` (the scan page sets it when the
// loader is done; elsewhere it's active at once), picking up from the loader's frozen 15% dots.
// Motion is cursor-only on desktop: slow parallax and a soft spotlight that ease back after 3s idle.
// Touch devices and reduced motion: fully static. Kept cheap: the canvases are drawn once (at most
// 1.5x pixels), and everything that moves is a GPU transform (no repaints).

const RED = "#FB2B2F";
// Brightness → glyph, dark to bright. Half the range is ↗ so strokes read as arrows: the "arrows"
// preset tops out at ↙, the opposite of the motif.
const ARROW_CHARS = " ·-/↗↗↗↗";
const REST = { arrows: 0.35, sparkle: 0.12 };
const START = 0.4; // entrance starts at 40% of rest: ~15% for the arrows
const ENTRANCE_MS = 800;
const PARALLAX = { arrows: 8, sparkle: -14 }; // px at the screen edge; the dots move the other way
const LERP = 0.06;
const IDLE_MS = 3000;
const SPOT_RADIUS = 200; // px; matches the .ascii-spot box
const MAX_DPR = 1.5; // decorative and dim: retina-sharp isn't worth the pixels

// Cursor parallax and spotlight. Writes transforms directly (compositor only); runs a frame loop only
// while moving.
function useCursorMotion(enabled: boolean) {
  const arrowsRef = useRef<HTMLDivElement>(null);
  const sparkleRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const arrows = arrowsRef.current;
    const sparkle = sparkleRef.current;
    const spot = spotRef.current;
    if (!enabled || !arrows || !sparkle || !spot) return;
    const target = { x: 0, y: 0 }; // -1..1 from the screen centre
    const pos = { x: 0, y: 0 };
    let lastMove = 0;
    let lastStep = 0;
    let frame = 0;

    const step = (now: number) => {
      // ~30fps: the parallax drifts a few px with heavy easing, so 60fps only doubles the work.
      if (now - lastStep < 30) {
        frame = requestAnimationFrame(step);
        return;
      }
      lastStep = now;
      const idle = now - lastMove > IDLE_MS;
      if (idle) {
        target.x = target.y = 0;
        spot.style.opacity = "0";
      }
      pos.x += (target.x - pos.x) * LERP * 2; // per 30fps step: same feel as LERP per 60fps frame
      pos.y += (target.y - pos.y) * LERP * 2;
      arrows.style.transform = `translate3d(${(pos.x * PARALLAX.arrows).toFixed(2)}px, ${(pos.y * PARALLAX.arrows).toFixed(2)}px, 0)`;
      sparkle.style.transform = `translate3d(${(pos.x * PARALLAX.sparkle).toFixed(2)}px, ${(pos.y * PARALLAX.sparkle).toFixed(2)}px, 0)`;
      frame = idle && Math.abs(pos.x) + Math.abs(pos.y) < 0.002 ? 0 : requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
      spot.style.transform = `translate3d(${e.clientX - SPOT_RADIUS}px, ${e.clientY - SPOT_RADIUS}px, 0)`;
      spot.style.opacity = "1";
      lastMove = performance.now();
      if (!frame) frame = requestAnimationFrame(step);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      arrows.style.transform = sparkle.style.transform = "";
    };
  }, [enabled]);

  return { arrowsRef, sparkleRef, spotRef };
}

export function SalesAsciiBackground({ active = true }: { active?: boolean }) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const desktop = useMediaQuery("(min-width: 1024px)", true);
  const tablet = useMediaQuery("(min-width: 640px)", true);
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const { arrowsRef, sparkleRef, spotRef } = useCursorMotion(active && finePointer && !reducedMotion);
  const [entered, setEntered] = useState(false);

  // The art box is at least 1.2× as wide as it is tall (see below), so on phones it is wider than the
  // screen: these keep the characters about the same size on every device (~13px).
  const resolution = desktop ? 120 : tablet ? 100 : 80;

  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => setEntered(true)); // one frame at the dim start, then settle
    return () => cancelAnimationFrame(id);
  }, [active]);

  const layerStyle = (rest: number) => ({
    opacity: entered ? rest : rest * START,
    transition: reducedMotion ? undefined : `opacity ${ENTRANCE_MS}ms ease-out`,
  });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      {/* Never narrower than 1.2× its height, so character cells stay roughly square on phones. Pinned
          left: on a phone the box is wider than the screen, and the art is brightest bottom-left. */}
      <div className="absolute inset-y-0 left-0 w-[max(100%,120vh)]">
        <div ref={arrowsRef} className="absolute -inset-[2%] will-change-transform" style={layerStyle(REST.arrows)}>
          <AsciiArt
            src={ASCII_FRAMES[0]}
            resolution={resolution}
            charset={ARROW_CHARS}
            color={RED}
            animated={false}
            maxDpr={MAX_DPR}
            className="absolute inset-0 h-full w-full"
          />
        </div>
        {/* Normal blending: white dots at 12% look the same as with screen, without the compositing cost. */}
        <div ref={sparkleRef} className="absolute -inset-[3%] will-change-transform" style={layerStyle(REST.sparkle)}>
          <AsciiArt
            src={ASCII_FRAMES[0]}
            resolution={Math.round(resolution * 0.6)}
            charset="dots"
            color="#ffffff"
            animated={false}
            maxDpr={MAX_DPR}
            className="absolute inset-0 h-full w-full scale-110"
          />
        </div>
      </div>
      <div ref={spotRef} className="ascii-spot absolute top-0 left-0 opacity-0 transition-opacity duration-700 will-change-transform" />
      <div className="ascii-bg-overlay absolute inset-0" />
    </div>
  );
}
