import Link from "next/link";
import type { CSSProperties } from "react";
import { SITE_NAME } from "@/lib/site";

// The site logo, hand-drawn style: a chunky slab "SE", the "O" drawn as a magnifying glass, and "audit"
// written underneath with an underline and a tick. Plain inline SVG in the server HTML: it shows at once on
// every device and stays sharp at any size. A noise filter roughens the edges like ink on paper; a thin
// offset outline gives the doubled pencil line. On load the letters pop in and the strokes draw themselves
// (CSS in globals.css: .logo-pop, .logo-draw); on hover (or tap) it wiggles and the lens tilts.
//   hero:    the landing page's big logo, in the page flow.
//   compact: fixed top-left, links home (scan and report pages).

const INK = "#1f1b17";
const delay = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

function LogoArt({ id }: { id: string }) {
  const rough = `${id}-rough`;
  return (
    <svg viewBox="0 0 440 250" role="img" aria-label={SITE_NAME} className="block h-auto w-full overflow-visible">
      <defs>
        <filter id={rough} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="4" />
        </filter>
      </defs>
      <g className="logo-art" filter={`url(#${rough})`}>
        {/* "SE": solid ink, then the same letters as a thin outline, nudged up-right. */}
        <g className="logo-pop" style={{ ...delay(0), fontFamily: "var(--font-slab)" }}>
          <text x="14" y="160" fontSize="150" textLength="236" lengthAdjust="spacingAndGlyphs" fill={INK}>
            SE
          </text>
          <text
            x="19"
            y="155"
            fontSize="150"
            textLength="236"
            lengthAdjust="spacingAndGlyphs"
            fill="none"
            stroke={INK}
            strokeWidth="1.6"
          >
            SE
          </text>
        </g>

        {/* "O": a magnifying glass. */}
        <g className="logo-lens">
          <g className="logo-pop" style={delay(0.15)}>
            <circle cx="322" cy="104" r="46" fill="none" stroke={INK} strokeWidth="26" />
            <circle cx="326" cy="100" r="62" fill="none" stroke={INK} strokeWidth="1.6" />
            {/* Shine on the glass. */}
            <path d="M298 92 C 300 80, 308 72, 320 70" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          </g>
          <path
            className="logo-draw"
            style={delay(0.45)}
            pathLength={1}
            d="M362 146 L 412 198"
            fill="none"
            stroke={INK}
            strokeWidth="24"
            strokeLinecap="round"
          />
        </g>

        {/* Sparkle by the lens. */}
        <path
          className="logo-draw"
          style={delay(0.9)}
          pathLength={1}
          d="M404 22 L 404 50 M390 36 L 418 36 M394 26 L 414 46"
          fill="none"
          stroke={INK}
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* "audit", underlined, with a tick. */}
        <text
          className="logo-pop"
          style={{ ...delay(0.6), fontFamily: "var(--font-hand)" }}
          x="206"
          y="226"
          fontSize="52"
          fontWeight="700"
          textAnchor="middle"
          fill={INK}
        >
          audit
        </text>
        <path
          className="logo-draw"
          style={delay(0.8)}
          pathLength={1}
          d="M130 240 C 180 231, 240 233, 286 238"
          fill="none"
          stroke={INK}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="logo-draw"
          style={delay(1.05)}
          pathLength={1}
          d="M294 210 L 307 224 L 334 190"
          fill="none"
          stroke={INK}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function Logo({ variant = "hero" }: { variant?: "hero" | "compact" }) {
  if (variant === "compact") {
    return (
      <Link
        href="/"
        aria-label={`${SITE_NAME} – Home`}
        className="group fixed top-5 left-6 z-50 block w-[110px] md:top-6 md:left-8 md:w-[140px]"
      >
        <LogoArt id="logo-compact" />
      </Link>
    );
  }
  return (
    <div className="group w-[240px] shrink-0 self-start sm:w-[300px]">
      <LogoArt id="logo-hero" />
    </div>
  );
}
