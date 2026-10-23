"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { logoFont } from "@/components/landing/logo-font";
import { drawLogoMasks, FRAME_LEFT, type LogoMasks } from "@/components/landing/logo-masks";
import { useMediaQuery } from "@/components/landing/media-hooks";
import { AsciiArt } from "@/components/ui/ascii-art";

// The Sales Inc. logo in ASCII blocks, over SalesAsciiBackground. Masks are drawn at runtime
// (logo-masks.ts), one AsciiArt per color. It reveals once (white SALES INC. as matrix rain, then the
// red frame, THE and arrows typing in) and then stays still. Hover nudges the red arrows up-right
// and brightens the glow. The glow is a CSS drop-shadow on the red layer, applied once it is still
// (a filter on a canvas that redraws every frame would be re-run every frame).
//   hero:    the landing page's big logo, in the page flow.
//   compact: fixed top-left, links home (scan page, mounted once the loader is done).

const RED = "#FB2B2F";

const VARIANTS = {
  hero: { resolution: 150, arrowShift: 14, delay: 0, whiteS: 1.2, redAt: 600, redS: 1.2, glow: 4 },
  // 96, not the brief's 48: at 48 "THE" is under one row and SALES reads as "$ALE$".
  // 3px of arrow shift at 180px wide is ~20 mask px.
  compact: { resolution: 96, arrowShift: 20, delay: 300, whiteS: 0.75, redAt: 250, redS: 0.75, glow: 2 },
} as const;

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

export function SalesAsciiLogo({ variant = "hero" }: { variant?: keyof typeof VARIANTS }) {
  const v = VARIANTS[variant];
  const animate = !useMediaQuery("(prefers-reduced-motion: reduce)");
  const [masks, setMasks] = useState<LogoMasks | null>(null);
  const [stage, setStage] = useState<Stage>("hidden");
  const [hovered, setHovered] = useState(false);

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
    const steps: [Stage, number][] = animate
      ? [["white", v.delay], ["red", v.delay + v.redAt], ["still", v.delay + v.redAt + v.redS * 1000]]
      : [["still", v.delay]];
    const timers = steps.map(([next, at]) => setTimeout(() => setStage(next), at));
    return () => timers.forEach(clearTimeout);
  }, [masks, animate, v]);

  const showRed = stage === "red" || stage === "still";
  const still = stage === "still";
  const redSrc = masks && (hovered && still ? masks.redShifted : masks.red);

  const art = masks && redSrc && stage !== "hidden" && (
    // AsciiArt lays its grid out for a square box; the 2:1 logo fills the middle half (the overflow
    // clip hides the rest, including matrix rain outside the logo).
    <div className="pointer-events-none absolute inset-x-0 top-1/2 aspect-square -translate-y-1/2">
      {showRed && (
        <div
          className="absolute inset-0 transition-[filter] duration-200 ease-out"
          style={{
            filter: still ? `drop-shadow(0 0 ${v.glow}px rgb(251 43 47 / ${hovered ? 0.9 : 0.5}))` : undefined,
          }}
        >
          <Layer
            src={redSrc}
            color={RED}
            resolution={v.resolution}
            style={animate ? "typewriter" : undefined}
            duration={v.redS}
          />
        </div>
      )}
      <Layer
        src={masks.white}
        color="#ffffff"
        resolution={v.resolution}
        style={animate ? "matrix" : undefined}
        duration={v.whiteS}
      />
    </div>
  );

  const hover = { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) };

  if (variant === "compact") {
    return (
      <Link
        href="/"
        aria-label="The Sales Inc. – Home"
        className="fixed top-5 left-6 z-50 block aspect-[2/1] w-[130px] overflow-hidden md:top-6 md:left-8 md:w-[180px]"
        {...hover}
      >
        {art}
      </Link>
    );
  }

  return (
    <div
      role="img"
      aria-label="The Sales Inc."
      className="relative aspect-[2/1] w-[45vw] max-w-md shrink-0 self-start overflow-hidden"
      // Pulled left by the mask's margin so the frame lines up with the heading below.
      style={{ translate: `-${(FRAME_LEFT * 100).toFixed(2)}% 0` }}
      {...hover}
    >
      {art}
    </div>
  );
}
