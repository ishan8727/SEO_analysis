// Films the live ASCII logo (dev page /dev/logo-capture, AsciiLogoSource.tsx) frame by frame and writes the
// files the site shows (SalesAsciiLogo.tsx), per variant into public/brand/:
//   logo-<variant>.webp        the reveal, animated, plays once and stops on the full logo
//   logo-<variant>-still.webp  the last frame (reduced motion)
//   logo-<variant>-hover.webp  the hover pose (red arrows nudged up-right)
// Time is driven with Playwright's fake clock, so every frame is exactly FRAME_MS apart. Each frame is the red
// and white AsciiArt canvases composited and encoded losslessly by the browser. To keep the file small, a
// frame holds only the rectangle that changed since the one before, and unchanged frames just lengthen it.
//   pnpm dev   (in another terminal), then:   pnpm logo:build [base-url]
import fs from "node:fs";
import WebP from "node-webpmux";
import { chromium, type Page } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "public/brand";
const FRAME_MS = 33; // ~30 fps
// 1 = drawn exactly as a laptop shows the live logo (hero 358×179, compact 180×90): there the ~3 px glyphs blend
// into clean blocks. At 2x+ the glyphs' own shading texture shows and looks broken once scaled. The site scales
// these up with image-rendering: pixelated, so they stay crisp on phones and retina screens.
const SCALE = Number(process.env.LOGO_SCALE ?? 1);
// Reveal length per variant: redAt + redS from SOURCE_VARIANTS in AsciiLogoSource.tsx.
const VARIANTS = { hero: 1800, compact: 1000 } as const;

interface Grab {
  x: number;
  y: number;
  buffer: Buffer;
}

/**
 * Composites both canvases (red under white), cropped to the 2:1 logo box, and returns it as a lossless WebP.
 * delta: only the rectangle that changed since the previous call on this page (null when nothing did).
 */
async function grab(page: Page, delta: boolean): Promise<Grab | null> {
  const res = await page.evaluate(async (delta) => {
    const box = document.querySelector<HTMLElement>("[data-logo-source]")!;
    const w = box.clientWidth;
    const canvases = [...box.querySelectorAll("canvas")];
    const ratio = (canvases[0]?.width ?? w * 2) / w;
    const W = Math.round(w * ratio);
    const H = Math.round((w / 2) * ratio);
    const full = new OffscreenCanvas(W, H);
    const ctx = full.getContext("2d", { willReadFrequently: true })!;
    // The layers are squares centred on the 2:1 box: the logo is the middle half.
    for (const c of canvases) ctx.drawImage(c, 0, (c.height - H) / 2, W, H, 0, 0, W, H);
    const now = ctx.getImageData(0, 0, W, H).data;

    const store = window as unknown as { __prev?: Uint8ClampedArray };
    const prev = store.__prev;
    store.__prev = now;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (delta && prev && prev.length === now.length) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (now[i] !== prev[i] || now[i + 1] !== prev[i + 1] || now[i + 2] !== prev[i + 2] || now[i + 3] !== prev[i + 3]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return null;
      // WebP frame offsets must be even.
      x0 -= x0 % 2;
      y0 -= y0 % 2;
    }
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const crop = new OffscreenCanvas(cw, ch);
    crop.getContext("2d")!.drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch);
    const blob = await crop.convertToBlob({ type: "image/webp", quality: 1 }); // 1 = lossless in Chromium
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return { x: x0, y: y0, b64: btoa(bin) };
  }, delta);
  return res && { x: res.x, y: res.y, buffer: Buffer.from(res.b64, "base64") };
}

async function openSource(page: Page, variant: string, hover: boolean) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1_000);
  await page.goto(`${BASE}/dev/logo-capture?variant=${variant}${hover ? "&hover=1" : ""}`);
  await page.waitForSelector('[data-logo-source][data-masks="ready"]', { timeout: 30_000 });
}

/** Advance the fake clock one frame, then give real async work (image decodes) a moment. */
async function tick(page: Page) {
  await page.clock.runFor(FRAME_MS);
  await page.waitForTimeout(25);
}

const browser = await chromium.launch({ channel: "msedge" });
fs.mkdirSync(OUT, { recursive: true });

for (const [variant, revealMs] of Object.entries(VARIANTS)) {
  // The reveal.
  const page = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: SCALE });
  await openSource(page, variant, false);
  const frames: (Grab & { delay: number })[] = [];
  for (let t = 0; t <= revealMs + 4 * FRAME_MS; t += FRAME_MS) {
    await tick(page);
    const g = await grab(page, true);
    if (g) frames.push({ ...g, delay: FRAME_MS });
    else if (frames.length) frames[frames.length - 1].delay += FRAME_MS; // nothing changed: hold the last frame
  }
  const still = (await grab(page, false))!.buffer;
  const stage = await page.getAttribute("[data-logo-source]", "data-stage");
  if (stage !== "still") throw new Error(`${variant}: reveal not finished (stage ${stage})`);
  await page.close();

  const full = new WebP.Image();
  await full.load(still);
  const anim = await Promise.all(
    // blend off: each rectangle replaces what's under it, transparency included.
    // node-webpmux writes x/y as given, and WebP stores offset / 2 (grab() keeps them even).
    frames.map((f) =>
      WebP.Image.generateFrame({ buffer: f.buffer, x: f.x / 2, y: f.y / 2, delay: f.delay, blend: false, dispose: false }),
    ),
  );
  await WebP.Image.save(`${OUT}/logo-${variant}.webp`, {
    width: full.width,
    height: full.height,
    frames: anim,
    loops: 1, // play once, stop on the last frame
    bgColor: [0, 0, 0, 0],
  });
  fs.writeFileSync(`${OUT}/logo-${variant}-still.webp`, still);

  // The hover pose: one frame, no reveal.
  const hoverPage = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: SCALE });
  await openSource(hoverPage, variant, true);
  for (let i = 0; i < 6; i++) await tick(hoverPage);
  fs.writeFileSync(`${OUT}/logo-${variant}-hover.webp`, (await grab(hoverPage, false))!.buffer);
  await hoverPage.close();

  const kb = (f: string) => `${Math.round(fs.statSync(`${OUT}/${f}`).size / 1024)} KB`;
  console.log(
    `${variant}: ${frames.length} frames, ${full.width}×${full.height}, reveal ${revealMs} ms — ` +
      `logo-${variant}.webp ${kb(`logo-${variant}.webp`)}, still ${kb(`logo-${variant}-still.webp`)}, ` +
      `hover ${kb(`logo-${variant}-hover.webp`)}`,
  );
}
await browser.close();
