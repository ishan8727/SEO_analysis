"use client";

import { useEffect, useState } from "react";
import { logoFont } from "@/components/landing/logo-font";
import { drawLogoMasks, type LogoMasks } from "@/components/landing/logo-masks";
import { AsciiArt } from "@/components/ui/ascii-art";

// The Sales Inc. logo in ASCII blocks, drawn live. Not shown on the site: scripts/make-logo-animation.ts
// films it on the dev page /dev/logo-capture and the site shows the result (public/brand/*.webp, see
// SalesAsciiLogo.tsx). One AsciiArt per color: the white SALES INC. reveals as matrix rain, then the red
// frame, THE and arrows type in, then it stays still. No glow here: the site adds it with CSS.
//   forceHover: the hover pose (red arrows nudged up-right), for the hover still.
//   data-masks / data-stage on the box tell the capture script when to start and when the reveal is over.

const RED = "#FB2B2F";

export const SOURCE_VARIANTS = {
  hero: { width: 358, resolution: 150, arrowShift: 14, delay: 0, whiteS: 1.2, redAt: 600, redS: 1.2 },
  // 96, not 48: at 48 "THE" is under one row and SALES reads as "$ALE$".
  compact: { width: 180, resolution: 96, arrowShift: 20, delay: 0, whiteS: 0.75, redAt: 250, redS: 0.75 },
} as const;

export type LogoVariant = keyof typeof SOURCE_VARIANTS;
type Stage = "hidden" | "white" | "red" | "still";

function Layer({ src, color, resolution, style, duration }: {
  src: string;
  color: string;
  resolution: number;
  style?: "matrix" | "typewriter"; // omitted: drawn at once
  duration?: number;
}) {
  return (
    <AsciiArt
      src={src}
      resolution={resolution}
      charset="blocks"
      color={color}
      objectFit="contain"
      animated={style !== undefined}
      animationStyle={style ?? "none"}
      animationDuration={duration}
      animateOnView={false}
      className="absolute inset-0 h-full w-full"
    />
  );
}

export function AsciiLogoSource({ variant, forceHover = false }: { variant: LogoVariant; forceHover?: boolean }) {
  const v = SOURCE_VARIANTS[variant];
  const [masks, setMasks] = useState<LogoMasks | null>(null);
  const [stage, setStage] = useState<Stage>("hidden");

  useEffect(() => {
    let cancelled = false;
    drawLogoMasks(logoFont.style.fontFamily, v.arrowShift)
      .then((m) => !cancelled && setMasks(m))
      .catch((err) => console.warn("logo masks failed:", err));
    return () => {
      cancelled = true;
    };
  }, [v.arrowShift]);

  useEffect(() => {
    if (!masks) return;
    // The hover still is a single frame: no reveal.
    const steps: [Stage, number][] = forceHover
      ? [["still", 0]]
      : [["white", v.delay], ["red", v.delay + v.redAt], ["still", v.delay + v.redAt + v.redS * 1000]];
    const timers = steps.map(([next, at]) => setTimeout(() => setStage(next), at));
    return () => timers.forEach(clearTimeout);
  }, [masks, forceHover, v]);

  const animate = !forceHover;
  const showRed = stage === "red" || stage === "still";
  const redSrc = masks && (forceHover ? masks.redShifted : masks.red);

  return (
    <div
      data-logo-source
      data-masks={masks ? "ready" : "loading"}
      data-stage={stage}
      className="relative aspect-[2/1] overflow-hidden"
      style={{ width: v.width }}
    >
      {masks && redSrc && stage !== "hidden" && (
        // AsciiArt lays its grid out for a square box; the 2:1 logo fills the middle half (the overflow
        // clip hides the rest, including matrix rain outside the logo).
        <div className="pointer-events-none absolute inset-x-0 top-1/2 aspect-square -translate-y-1/2">
          {showRed && (
            <Layer
              src={redSrc}
              color={RED}
              resolution={v.resolution}
              style={animate ? "typewriter" : undefined}
              duration={v.redS}
            />
          )}
          <Layer
            src={masks.white}
            color="#ffffff"
            resolution={v.resolution}
            style={animate ? "matrix" : undefined}
            duration={v.whiteS}
          />
        </div>
      )}
    </div>
  );
}
