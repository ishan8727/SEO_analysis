// Generates the landing page background frames: public/ascii/bg-frame-1..4.svg. `pnpm ascii:frames`
//
// Grayscale on black (AsciiArt turns brightness into characters): white arrows and dashed speed lines
// rising up-right, brightest in the bottom-left, fading toward the top-right and the centre, where the
// hero text sits. Each frame moves every lane one step along its path. A lane repeats every 4 steps,
// so frame 4 → frame 1 loops without a jump.
//
// AsciiArt (objectFit "cover") crops a centred square from the source and stretches it to the screen.
// So the frames are square and the arrows are drawn steeper than 45°; stretched to a 16:9 screen
// they come out at about 45°.
import { mkdirSync, writeFileSync } from "node:fs";

const SIZE = 1200;
const STRETCH = 1.7; // typical screen width / height the square gets stretched to
const FRAMES = 4;
const STEP = 60; // px a slow lane moves per frame (~45px on screen); fast lanes move twice as far

type Point = { x: number; y: number };

const norm = Math.hypot(1, STRETCH);
const along: Point = { x: 1 / norm, y: -STRETCH / norm }; // up-right (SVG y points down)
const across: Point = { x: STRETCH / norm, y: 1 / norm };

// Seeded so the frames come out the same every run.
let seed = 7;
function rand(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// 0..1 for a point: bright bottom-left, near-black top-right, calm centre.
function brightness({ x, y }: Point): number {
  const nx = x / SIZE;
  const ny = y / SIZE;
  const diagonal = Math.min(1, (nx + (1 - ny)) / 2); // 0 at bottom-left, 1 at top-right
  const corner = 0.08 + 0.92 * Math.pow(1 - diagonal, 1.2);
  const centre = smoothstep(0.14, 0.38, Math.hypot(nx - 0.5, ny - 0.5));
  return corner * centre;
}

const point = (offset: number, t: number): Point => ({
  x: offset * across.x + t * along.x,
  y: offset * across.y + t * along.y,
});

const rotate = (p: Point, degrees: number): Point => {
  const r = (degrees * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

const f = (n: number) => n.toFixed(1);

// Range of the square along and across the lanes.
const corners: Point[] = [
  { x: 0, y: 0 },
  { x: SIZE, y: 0 },
  { x: 0, y: SIZE },
  { x: SIZE, y: SIZE },
];
const dot = (p: Point, d: Point) => p.x * d.x + p.y * d.y;
const [acrossMin, acrossMax] = [Math.min(...corners.map((c) => dot(c, across))), Math.max(...corners.map((c) => dot(c, across)))];
const [alongMin, alongMax] = [Math.min(...corners.map((c) => dot(c, along))), Math.max(...corners.map((c) => dot(c, along)))];

interface Lane {
  offset: number;
  speed: number;
  period: number; // 4 × speed, so the lane looks the same again after 4 frames
  phase: number;
  kind: "arrow" | "dashes";
  length: number;
  width: number;
  level: number;
  threshold: number; // sparse lanes only show where the background is bright
}

const lanes: Lane[] = [];
for (let offset = acrossMin - 20; offset < acrossMax + 20; offset += 34 + rand() * 46) {
  const fast = rand() < 0.3;
  const speed = fast ? STEP * 2 : STEP;
  const period = speed * FRAMES;
  lanes.push({
    offset,
    speed,
    period,
    phase: rand() * period,
    kind: rand() < 0.55 ? "arrow" : "dashes",
    length: Math.min(110 + rand() * 150, period * 0.55),
    width: 20 + rand() * 16,
    level: 0.7 + rand() * 0.3,
    threshold: rand() * 0.35,
  });
}

function laneShapes(lane: Lane, frame: number): string[] {
  const shapes: string[] = [];
  const first = lane.phase + frame * lane.speed;
  const startT = first - Math.ceil((first - (alongMin - lane.length * 1.5)) / lane.period) * lane.period;
  for (let t = startT; t < alongMax + lane.length; t += lane.period) {
    const tail = point(lane.offset, t);
    const head = point(lane.offset, t + lane.length);
    const b = brightness(point(lane.offset, t + lane.length / 2));
    // Fade (not pop) in and out at the lane's threshold as the shape moves.
    const opacity = b * lane.level * smoothstep(lane.threshold, lane.threshold + 0.15, b);
    if (opacity < 0.04) continue;
    const style = `stroke-width="${f(lane.width)}" stroke-opacity="${opacity.toFixed(3)}"`;

    if (lane.kind === "arrow") {
      const back = { x: -along.x * lane.length * 0.32, y: -along.y * lane.length * 0.32 };
      const [b1, b2] = [rotate(back, 35), rotate(back, -35)];
      shapes.push(`<line x1="${f(tail.x)}" y1="${f(tail.y)}" x2="${f(head.x)}" y2="${f(head.y)}" ${style}/>`);
      shapes.push(
        `<polyline points="${f(head.x + b1.x)},${f(head.y + b1.y)} ${f(head.x)},${f(head.y)} ${f(head.x + b2.x)},${f(head.y + b2.y)}" ${style}/>`,
      );
      // Short dashed trail behind the arrow.
      const trail = point(lane.offset, t - lane.length * 0.4);
      shapes.push(
        `<line x1="${f(tail.x)}" y1="${f(tail.y)}" x2="${f(trail.x)}" y2="${f(trail.y)}" stroke-dasharray="14 12" stroke-width="${f(lane.width * 0.7)}" stroke-opacity="${(opacity * 0.6).toFixed(3)}"/>`,
      );
    } else {
      // Speed lines: drawn head → tail so the longest dash leads.
      const L = lane.length;
      const dashes = `${f(L * 0.45)} ${f(L * 0.12)} ${f(L * 0.22)} ${f(L * 0.12)} ${f(L * 0.09)} 9999`;
      shapes.push(
        `<line x1="${f(head.x)}" y1="${f(head.y)}" x2="${f(tail.x)}" y2="${f(tail.y)}" stroke-dasharray="${dashes}" ${style}/>`,
      );
    }
  }
  return shapes;
}

// Static logo motifs: a thin frame and a small hollow circle, bottom-left.
const motifs = [
  `<rect x="70" y="840" width="280" height="190" stroke-width="8" stroke-opacity="0.35"/>`,
  `<circle cx="330" cy="760" r="26" stroke-width="9" stroke-opacity="0.5"/>`,
];

mkdirSync("public/ascii", { recursive: true });
for (let frame = 0; frame < FRAMES; frame++) {
  const body = [...motifs, ...lanes.flatMap((lane) => laneShapes(lane, frame))].join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<rect width="${SIZE}" height="${SIZE}" fill="#000"/>
<g fill="none" stroke="#fff" stroke-linecap="square">
${body}
</g>
</svg>
`;
  writeFileSync(`public/ascii/bg-frame-${frame + 1}.svg`, svg);
}
console.log(`wrote ${FRAMES} frames to public/ascii/ (${lanes.length} lanes)`);
