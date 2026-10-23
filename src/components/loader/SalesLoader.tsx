"use client";

import { useEffect, useRef, useState } from "react";
import { ASCII_FRAMES } from "@/components/landing/ascii-frames";

// Full-screen loader in the site's ASCII style: a dot field (" ·•●", AsciiArt's "dots") with rings
// pulsing out from the centre, and a percentage. Given `progress`/`complete` (the scan page passes
// the audit's progress), the counter climbs in random jumps that never pass the real progress and
// hits 100% only when `complete`. Without them it follows page loading (fonts, the background frames,
// window load). At 100% a red scan line sweeps down, freezing the dots above it, then the loader
// fades out. One plain canvas and a few DOM nodes: no AsciiArt or motion, no per-frame renders.
// Kept cheap: per-cell values precomputed on resize; each frame the dots are written into one pixel
// buffer and put on the canvas in a single call (thousands of draw calls were the main cost); 1x
// pixels, 12fps while rings pulse (dots snap to the grid, so more frames add nothing visible), 30fps
// for the finishing scan line.

const CHARS = " ·•●";
const RING_FRAME_MS = 1000 / 12; // rings move ~1 grid row per frame at this rate
const SCAN_FRAME_MS = 1000 / 30; // the finishing scan line needs to be smooth
const RING_EVERY_MS = 1400;
const RING_SPEED = 180; // px/s
const RING_THICKNESS = 60;
const CLEAR_RADIUS = 140; // dots under the text are capped at 15% opacity
const CLEAR_FEATHER = 80;
const MIN_MS = 1800;
const MAX_MS = 6000; // page-loading mode: give up waiting
const SAFETY_MS = 120_000; // `complete` never came (stuck scan): get out of the way
const SCAN_MS = 700;
const FADE_MS = 400;
const ALPHA_STEPS = 20; // opacity steps, each with precomputed pixel values
const NOISE_EVERY = 2; // frames between idle-noise refreshes

// Value noise lattice for the idle "·" floor.
const LATTICE = Float32Array.from({ length: 256 * 256 }, () => Math.random());
const lattice = (x: number, y: number) => LATTICE[(x & 255) | ((y & 255) << 8)];

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const a = lattice(xi, yi);
  const b = lattice(xi + 1, yi);
  const c = lattice(xi, yi + 1);
  const d = lattice(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const glyphFor = (i: number) => (i < 0.06 ? 0 : i < 0.35 ? 1 : i < 0.7 ? 2 : 3);

type Phase = "loading" | "ready" | "fading" | "done";

export function SalesLoader({
  progress,
  complete = false,
  onComplete,
}: {
  /** Real progress, 0–1. Omit to track page loading instead. */
  progress?: number;
  /** What the loader waits for is finished: run to 100% and leave. */
  complete?: boolean;
  onComplete?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  const trackRef = useRef({ progress, complete });

  useEffect(() => {
    onCompleteRef.current = onComplete;
    trackRef.current = { progress, complete };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    const external = trackRef.current.progress !== undefined;

    // Page-loading mode: three things to wait for.
    let loaded = 0;
    const markLoaded = () => loaded++;
    document.fonts.ready.then(markLoaded, markLoaded);
    Promise.all(
      ASCII_FRAMES.map(
        (src) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = img.onerror = resolve;
            img.src = src;
          }),
      ),
    ).then(markLoaded);
    if (external || document.readyState === "complete") markLoaded();
    else window.addEventListener("load", markLoaded, { once: true });

    // Grid. Everything per cell that doesn't change between frames is computed on resize.
    let w = 0, h = 0, cols = 0, rows = 0, charW = 0, lineH = 0, maxRadius = 0;
    let glyphs = new Uint8Array(0); // last glyph per cell; frozen rows keep theirs
    let dist = new Float32Array(0); // distance from the centre
    let cap = new Float32Array(0); // opacity cap: dim under the text
    let noiseGain = new Float32Array(0); // fixed per-cell factor, so the idle dots scatter
    let noise = new Float32Array(0); // idle floor, refreshed every NOISE_EVERY frames
    let redPick = new Uint8Array(0); // ~40% of cells may turn red on a crest
    // Pixel buffer and glyph shapes. Each glyph is drawn once to measure which pixels of a cell it
    // covers; `packed` holds the RGBA value of each of those pixels per colour and opacity step.
    let image: ImageData | null = null;
    let pixels = new Uint32Array(0);
    let shapes: Int32Array[] = []; // per glyph: pixel offsets inside a cell (canvas row stride)
    let packed: Uint32Array[] = []; // per tile(): one RGBA value per shape pixel
    const tile = (glyph: number, red: boolean, step: number) => ((red ? ALPHA_STEPS + 1 : 0) + step) * 3 + glyph - 1;

    const updateNoise = (t: number) => {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          // Cells whose gain can't reach the first glyph stay empty: skip the noise maths.
          noise[idx] = noiseGain[idx] < 0.06 ? 0 : noiseGain[idx] * valueNoise(c * 0.12 + t * 0.0003, r * 0.25 - t * 0.0002);
        }
      }
    };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      // 1x pixels: the dots are tiny and dim, and retina resolution would quadruple the pixels drawn.
      canvas.width = w;
      canvas.height = h;
      const fontSize = w < 640 ? 10 : 12;
      const font = `${fontSize}px ui-monospace, monospace`;
      ctx.font = font;
      charW = Math.ceil(ctx.measureText("●").width) || Math.ceil(fontSize * 0.6);
      lineH = Math.round(fontSize * 1.4);
      cols = Math.floor(w / charW); // whole cells only, so no glyph spills past the buffer's edge
      rows = Math.floor(h / lineH);
      maxRadius = Math.hypot(w, h) / 2;

      const n = cols * rows;
      glyphs = new Uint8Array(n);
      dist = new Float32Array(n);
      cap = new Float32Array(n);
      noiseGain = new Float32Array(n);
      noise = new Float32Array(n);
      redPick = new Uint8Array(n);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const d = Math.hypot(c * charW + charW / 2 - w / 2, r * lineH + lineH / 2 - h / 2);
          dist[idx] = d;
          cap[idx] = d < CLEAR_RADIUS + CLEAR_FEATHER ? 0.15 + 0.85 * Math.max(0, (d - CLEAR_RADIUS) / CLEAR_FEATHER) : 1;
          noiseGain[idx] = 0.08 * 1.8 * lattice(c * 3 + 1, r * 5 + 2);
          redPick[idx] = lattice(c * 7, r * 13) < 0.4 ? 1 : 0;
        }
      }

      image = ctx.createImageData(w, h);
      pixels = new Uint32Array(image.data.buffer);
      const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (probe) {
        probe.canvas.width = charW;
        probe.canvas.height = lineH;
        probe.font = font;
        probe.textBaseline = "top";
        probe.fillStyle = "#fff";
        const coverage: Float32Array[] = [];
        shapes = [];
        for (let g = 1; g <= 3; g++) {
          probe.clearRect(0, 0, charW, lineH);
          probe.fillText(CHARS[g], 0, 0);
          const data = probe.getImageData(0, 0, charW, lineH).data;
          const offsets: number[] = [];
          const cover: number[] = [];
          for (let py = 0; py < lineH; py++) {
            for (let px = 0; px < charW; px++) {
              const a = data[(py * charW + px) * 4 + 3];
              if (a > 8) {
                offsets.push(py * w + px);
                cover.push(a / 255);
              }
            }
          }
          shapes.push(Int32Array.from(offsets));
          coverage.push(Float32Array.from(cover));
        }
        packed = [];
        for (const red of [false, true]) {
          const [cr, cg, cb] = red ? [251, 43, 47] : [255, 255, 255];
          for (let step = 0; step <= ALPHA_STEPS; step++) {
            for (let g = 1; g <= 3; g++) {
              // ImageData is RGBA in memory: as a little-endian Uint32 that is A<<24 | B<<16 | G<<8 | R.
              packed[tile(g, red, step)] = Uint32Array.from(
                coverage[g - 1],
                (cv) => ((Math.round((255 * cv * step) / ALPHA_STEPS) << 24) | (cb << 16) | (cg << 8) | cr) >>> 0,
              );
            }
          }
        }
      }
      frame = 0; // refresh the noise on the next draw
      if (reduced) draw(performance.now());
    };

    const start = performance.now();
    const rings: number[] = [start]; // birth times
    let lastFrame = 0;
    let frame = 0;
    let shown = 0;
    let nextJumpAt = 0;
    let finishAt = 0;
    let raf = 0;

    const put = (glyph: number, red: boolean, step: number, c: number, y: number) => {
      const offsets = shapes[glyph - 1];
      const values = packed[tile(glyph, red, step)];
      if (!offsets || !values) return;
      const base = y * w + c * charW;
      for (let k = 0; k < offsets.length; k++) pixels[base + offsets[k]] = values[k];
    };

    const draw = (now: number) => {
      if (frame++ % NOISE_EVERY === 0) updateNoise(now - start);
      const scanY = finishAt && !reduced ? Math.min(1, (now - finishAt) / SCAN_MS) * h : -1;
      const radii = rings.map((born) => ((now - born) / 1000) * RING_SPEED);
      // Fades late (squared), so crests are still bright enough to turn red mid-screen.
      const fades = radii.map((radius) => Math.max(0, 1 - (radius / maxRadius) ** 2));
      pixels.fill(0);

      for (let r = 0; r < rows; r++) {
        const y = r * lineH;
        const frozen = y + lineH <= scanY;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (frozen) {
            if (glyphs[idx]) put(glyphs[idx], false, 3, c, y); // white, 15%
            continue;
          }
          let i = noise[idx];
          const d = dist[idx];
          for (let k = 0; k < radii.length; k++) {
            const v = 1 - Math.abs(d - radii[k]) / RING_THICKNESS;
            if (v > 0) i += v * fades[k];
          }
          const glyph = glyphFor(i);
          glyphs[idx] = glyph;
          if (!glyph) continue;
          // Red only on the crest, and only ~40% of crest cells.
          const red = i > 0.85 && redPick[idx] === 1;
          const alpha = Math.min(cap[idx], red ? Math.min(0.7, 0.5 + (i - 0.85)) : 0.1 + 0.25 * Math.min(1, i));
          put(glyph, red, Math.round(alpha * ALPHA_STEPS), c, y);
        }
      }

      if (image) ctx.putImageData(image, 0, 0);

      if (scanY >= 0 && scanY < h) {
        ctx.save();
        ctx.shadowColor = "#FB2B2F";
        ctx.shadowBlur = 20;
        ctx.fillStyle = "#FB2B2F";
        ctx.fillRect(0, scanY, w, 1);
        ctx.restore();
      }
    };

    const finish = () => {
      root.style.overflow = prevOverflow;
      setPhase("done");
      onCompleteRef.current?.();
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastFrame < (finishAt ? SCAN_FRAME_MS : RING_FRAME_MS)) return;
      lastFrame = now;
      const elapsed = now - start;

      if (external) {
        // Random jumps up to the real progress (held just under 100% until complete).
        const done = trackRef.current.complete || elapsed > SAFETY_MS;
        const ceiling = Math.min(done ? 1 : Math.min(0.97, trackRef.current.progress ?? 0), elapsed / MIN_MS);
        if (shown < ceiling && now >= nextJumpAt) {
          shown = Math.min(ceiling, shown + (done ? 0.05 : 0.01) + Math.random() * (done ? 0.08 : 0.03));
          nextJumpAt = now + (done ? 60 : 250 + Math.random() * 550);
        }
      } else {
        // Eases toward page loading, never done before MIN_MS, forced done at MAX_MS.
        const goal = Math.min(elapsed > MAX_MS ? 1 : loaded / 3, elapsed / MIN_MS);
        shown = goal - shown < 0.004 ? goal : shown + (goal - shown) * 0.2;
      }
      const pct = Math.round(shown * 100);
      if (counterRef.current) counterRef.current.textContent = `${pct < 10 ? "0" : ""}${pct}%`;
      if (barRef.current) barRef.current.style.transform = `scaleX(${shown})`;

      if (!finishAt && shown >= 1) {
        finishAt = now;
        setPhase("ready");
      }
      if (finishAt) {
        const since = now - finishAt;
        const fadeAt = reduced ? 300 : SCAN_MS;
        if (since >= fadeAt + FADE_MS) {
          cancelAnimationFrame(raf);
          finish();
          return;
        }
        if (since >= fadeAt) setPhase("fading");
      } else if (!reduced && now - rings[rings.length - 1] >= RING_EVERY_MS) {
        rings.push(now);
      }
      while (rings.length && ((now - rings[0]) / 1000) * RING_SPEED > maxRadius + RING_THICKNESS) rings.shift();

      if (!reduced) draw(now);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("load", markLoaded);
      root.style.overflow = prevOverflow;
    };
  }, []);

  if (phase === "done") return null;
  const finishing = phase !== "loading";

  return (
    <div
      className="fixed inset-0 z-[100] bg-black transition-opacity ease-out"
      style={{ opacity: phase === "fading" ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      {/* Dark zone behind the text, on top of the canvas's own dimming near the centre. */}
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 size-[420px] -translate-1/2 rounded-full bg-[radial-gradient(circle,#000_0%,rgb(0_0_0/0.8)_40%,transparent_70%)]"
      />
      <div
        role="status"
        className="absolute top-1/2 left-1/2 flex -translate-1/2 flex-col items-center gap-3 transition-opacity duration-300"
        style={{ opacity: finishing ? 0 : 1, transitionDelay: finishing ? "300ms" : "0ms" }}
      >
        <span className="text-xs tracking-[0.4em] text-white/60 uppercase">{finishing ? "Ready" : "Loading"}</span>
        <span ref={counterRef} aria-hidden className="font-mono text-5xl text-white tabular-nums">
          00%
        </span>
        <div aria-hidden className="h-px w-40 overflow-hidden bg-white/10">
          <div ref={barRef} className="h-full origin-left scale-x-0 bg-[#FB2B2F]" />
        </div>
      </div>
    </div>
  );
}
