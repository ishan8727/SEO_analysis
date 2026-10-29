// Page background: warm paper with a faint grain (.paper-bg in globals.css) and pencil doodles around the
// edges, kept faint so they never compete with the content. Static, server-rendered, no JavaScript. Phones get
// only the doodles that sit clear of the content column.

type Doodle = { d: string; className: string; rotate: number; wide?: boolean };

const DOODLES: Doodle[] = [
  // Star
  { d: "M50 12 L61 40 L90 41 L67 59 L75 88 L50 71 L25 88 L33 59 L10 41 L39 40 Z", className: "top-[6%] left-[4%] w-20", rotate: -8 },
  // Browser window
  { d: "M12 22 H88 V78 H12 Z M12 34 H88 M20 28 h2 M27 28 h2 M22 48 H70 M22 58 H60 M22 68 H50", className: "top-[30%] left-[3%] w-28", rotate: 6, wide: true },
  // Bar chart
  { d: "M15 15 L15 85 L90 85 M28 85 V60 H40 V85 M50 85 V45 H62 V85 M72 85 V28 H84 V85", className: "bottom-[22%] left-[5%] w-24", rotate: -4, wide: true },
  // Tick in a circle
  { d: "M50 12 C75 10 90 30 88 52 C86 76 66 90 46 88 C24 86 10 68 12 48 C14 26 30 14 54 13 M32 50 L45 64 L70 34", className: "bottom-[5%] left-[12%] w-20", rotate: 10 },
  // Curved arrow
  { d: "M10 80 C30 30 60 20 88 30 M74 18 L89 30 L73 40", className: "top-[5%] right-[8%] w-28", rotate: 4 },
  // Rising trend
  { d: "M10 80 L35 55 L52 66 L85 25 M70 24 L86 24 L86 40", className: "top-[34%] right-[4%] w-24", rotate: -6, wide: true },
  // Magnifier
  { d: "M40 15 C58 14 68 28 66 42 C64 58 50 66 38 64 C22 62 14 48 16 36 C18 24 28 16 42 15 M60 58 L86 86", className: "bottom-[24%] right-[6%] w-24", rotate: 8, wide: true },
  // Scribble spiral
  { d: "M50 50 c5 -5 12 2 8 9 c-5 9 -20 6 -20 -6 c0 -15 20 -22 30 -10 c12 14 2 34 -16 34 c-22 0 -32 -24 -20 -40", className: "right-[10%] bottom-[4%] w-20", rotate: 0 },
];

export function PaperBackground() {
  return (
    <div aria-hidden className="paper-bg pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg className="absolute size-0">
        <filter id="doodle-rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="2.5" />
        </filter>
      </svg>
      {DOODLES.map((doodle, i) => (
        <svg
          key={i}
          viewBox="0 0 100 100"
          className={`absolute h-auto opacity-[0.13] ${doodle.className} ${doodle.wide ? "hidden lg:block" : ""}`}
          style={{ rotate: `${doodle.rotate}deg` }}
        >
          <path
            d={doodle.d}
            filter="url(#doodle-rough)"
            fill="none"
            stroke="#1f1b17"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </div>
  );
}
