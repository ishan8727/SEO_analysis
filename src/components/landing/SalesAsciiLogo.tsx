"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FRAME_LEFT } from "@/components/landing/logo-masks";
import { useMediaQuery } from "@/components/landing/media-hooks";

// The Sales Inc. logo: the ASCII reveal pre-rendered as an animated WebP (scripts/make-logo-animation.ts films
// AsciiLogoSource.tsx; files in public/brand/). It's a plain image in the server HTML, so it shows on every
// device without waiting for JavaScript, fonts or canvas work. It plays once and stops on the full logo.
// The files are drawn at laptop size (1x: hero 358 px, compact 180 px), where the ASCII glyphs look clean, and
// scaled up with image-rendering: pixelated so they stay crisp. Widths are picked so phones scale by whole numbers
// (hero 239 px and compact 120 px are exactly 2x on a 3x screen; 358/180 px are 1x or 2x on laptops).
// Once played: a red glow, and on hover (or tap) the arrows nudge up-right, the glow brightens and the
// logo lifts a little. Reduced motion: the still, no reveal.
//   hero:    the landing page's big logo, in the page flow.
//   compact: fixed top-left, links home (scan, report and privacy pages).

const VARIANTS = {
  // revealMs: the animation's length (VARIANTS in scripts/make-logo-animation.ts).
  hero: { src: "/brand/logo-hero", width: 358, height: 179, revealMs: 1800 },
  compact: { src: "/brand/logo-compact", width: 180, height: 90, revealMs: 1000 },
} as const;

const GLOW = "[filter:drop-shadow(0_0_4px_rgb(251_43_47/0.5))]";
const GLOW_HOVER =
  "group-hover:[filter:drop-shadow(0_0_10px_rgb(251_43_47/0.9))] group-active:[filter:drop-shadow(0_0_10px_rgb(251_43_47/0.9))]";
const LIFT = "group-hover:translate-x-[2px] group-hover:-translate-y-[2px] group-active:translate-x-[2px] group-active:-translate-y-[2px]";

export function SalesAsciiLogo({ variant = "hero" }: { variant?: keyof typeof VARIANTS }) {
  const v = VARIANTS[variant];
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [played, setPlayed] = useState(false);

  // The image may finish loading before hydration, when onLoad has already fired.
  useEffect(() => {
    if (img.current?.complete) setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => setPlayed(true), reducedMotion ? 0 : v.revealMs);
    return () => clearTimeout(timer);
  }, [loaded, reducedMotion, v.revealMs]);

  const hero = variant === "hero";
  const logo = (
    <span
      className={`relative block transition-[translate,filter] duration-200 ease-out ${played ? `${GLOW} ${GLOW_HOVER} ${LIFT}` : ""}`}
    >
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet={`${v.src}-still.webp`} />
        <img
          ref={img}
          src={`${v.src}.webp`}
          width={v.width}
          height={v.height}
          alt={hero ? "The Sales Inc." : ""}
          fetchPriority={hero ? "high" : "auto"}
          loading="eager"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className="block h-auto w-full [image-rendering:pixelated]"
        />
      </picture>
      {played && (
        // The hover pose (arrows nudged), faded in over the finished logo.
        // eslint-disable-next-line @next/next/no-img-element -- static brand asset
        <img
          src={`${v.src}-hover.webp`}
          width={v.width}
          height={v.height}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0 [image-rendering:pixelated] transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100"
        />
      )}
    </span>
  );

  if (!hero) {
    return (
      <Link
        href="/"
        aria-label="The Sales Inc. – Home"
        className="group fixed top-5 left-6 z-50 block w-[120px] md:top-6 md:left-8 md:w-[180px]"
      >
        {logo}
      </Link>
    );
  }

  return (
    <div
      className="group w-[239px] max-w-[64vw] shrink-0 self-start sm:w-[36vw] sm:max-w-[358px]"
      // Pulled left by the artwork's margin so the frame lines up with the heading below.
      style={{ translate: `-${(FRAME_LEFT * 100).toFixed(2)}% 0` }}
    >
      {logo}
    </div>
  );
}
