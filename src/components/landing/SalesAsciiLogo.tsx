"use client";

import { useEffect, useState } from "react";
import { drawLogoMasks, FRAME_LEFT, type LogoMasks } from "@/components/landing/logo-masks";
import { useMediaQuery, usePageVisible } from "@/components/landing/media-hooks";
import { AsciiArt } from "@/components/ui/ascii-art";
import { cn } from "@/lib/utils";

// The Sales Inc. logo in ASCII blocks, over SalesAsciiBackground. Masks are drawn at runtime
// (logo-masks.ts), one AsciiArt per color.
// Intro: white SALES INC. resolves as matrix rain (0–1.2s), the red frame, THE and arrows type in
// (0.6–1.8s). Then idle loops: the arrows shoot up-right every 4s (1s on hover), a red/white split
// glitch every 7s, a quick fade "refresh" of the white words every 12s.

const RED = "#FB2B2F";
// Characters across. The grid has only ~0.27 rows per column across the logo, so anything much
// lower leaves the small "THE" unreadable. Same on every screen: the logo is small, so it's cheap.
const RESOLUTION = 150;
const RED_AT_MS = 600;
const IDLE_AT_MS = 1800;

function Layer({ src, color, animated, style, duration }: {
  src: string;
  color: string;
  animated: boolean;
  style: "matrix" | "typewriter" | "fade" | "none";
  duration?: number;
}) {
  return (
    <AsciiArt
      src={src}
      resolution={RESOLUTION}
      charset="blocks"
      color={color}
      objectFit="contain"
      animated={animated}
      animationStyle={animated ? style : "none"}
      animationDuration={duration}
      animateOnView={false}
      className="absolute inset-0 h-full w-full"
    />
  );
}

export function SalesAsciiLogo({ fontFamily }: { fontFamily: string }) {
  const animate = !useMediaQuery("(prefers-reduced-motion: reduce)");

  const visible = usePageVisible();
  const [masks, setMasks] = useState<LogoMasks | null>(null);
  const [stage, setStage] = useState<"white" | "red" | "idle">("white");
  const [hovered, setHovered] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [whiteKey, setWhiteKey] = useState(0); // bumped to replay the white layer's fade

  const showRed = !animate || stage !== "white";
  const idle = !animate || stage === "idle";
  const looping = animate && stage === "idle" && visible;

  useEffect(() => {
    let cancelled = false;
    drawLogoMasks(fontFamily)
      .then((m) => !cancelled && setMasks(m))
      .catch((err) => console.warn("logo masks failed:", err));
    return () => {
      cancelled = true;
    };
  }, [fontFamily]);

  useEffect(() => {
    if (!masks || !animate) return;
    const red = setTimeout(() => setStage("red"), RED_AT_MS);
    const idle = setTimeout(() => setStage("idle"), IDLE_AT_MS);
    return () => {
      clearTimeout(red);
      clearTimeout(idle);
    };
  }, [masks, animate]);

  // Arrows shoot up-right and back.
  useEffect(() => {
    if (!looping) return;
    let back: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(
      () => {
        setShifted(true);
        back = setTimeout(() => setShifted(false), 250);
      },
      hovered ? 1000 : 4000,
    );
    return () => {
      clearInterval(interval);
      clearTimeout(back);
      setShifted(false);
    };
  }, [looping, hovered]);

  // Red/white split flicker.
  useEffect(() => {
    if (!looping) return;
    let off: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setGlitch(true);
      off = setTimeout(() => setGlitch(false), 150);
    }, 7000);
    return () => {
      clearInterval(interval);
      clearTimeout(off);
      setGlitch(false);
    };
  }, [looping]);

  // Remounting the white layer replays a short fade.
  useEffect(() => {
    if (!looping) return;
    const interval = setInterval(() => setWhiteKey((k) => k + 1), 12000);
    return () => clearInterval(interval);
  }, [looping]);

  const redSrc = masks && (shifted ? masks.redShifted : masks.red);

  return (
    <div
      role="img"
      aria-label="The Sales Inc."
      className="relative aspect-[2/1] w-[45vw] max-w-md shrink-0 self-start overflow-hidden"
      // Pulled left by the mask's margin so the frame lines up with the heading below.
      style={{ translate: `-${(FRAME_LEFT * 100).toFixed(2)}% 0` }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {masks && redSrc && (
        // AsciiArt lays its grid out for a square box; the 2:1 logo fills the middle half (the
        // overflow clip hides the rest, including matrix rain outside the logo).
        <div className="pointer-events-none absolute inset-x-0 top-1/2 aspect-square -translate-y-1/2">
          {showRed && (
            <div
              className={cn(
                "absolute inset-0 blur-[4px] transition-opacity duration-500",
                !idle ? "opacity-0" : hovered ? "opacity-90" : "opacity-50",
              )}
            >
              <Layer src={redSrc} color={RED} animated={false} style="none" />
            </div>
          )}
          {showRed && (
            <Layer src={redSrc} color={RED} animated={animate} style="typewriter" duration={1.2} />
          )}
          <Layer
            key={whiteKey}
            src={masks.white}
            color="#ffffff"
            animated={animate}
            style={whiteKey === 0 ? "matrix" : "fade"}
            duration={whiteKey === 0 ? 1.2 : 0.4}
          />
          {looping && (
            <div
              className="absolute inset-0 mix-blend-screen"
              style={{ opacity: glitch ? 1 : 0, transform: glitch ? "translate(3px, -2px)" : undefined }}
            >
              <Layer src={masks.white} color={RED} animated={false} style="none" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
