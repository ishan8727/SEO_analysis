// The Sales Inc. logo as white-on-black masks for AsciiArt, which draws one color per instance:
// `white` has the words SALES and INC., `red` has the frame, "THE" and the arrows. Both share one size
// and layout, so the layers line up. `redShifted` is `red` with the arrows nudged up-right (idle loop).
//
// Positions are traced from the brand artwork (target/Images/TSI logo.gif, 1080px square, frame at
// x 108–972, y 338–775) and scaled into the mask with some margin for the glow.

export const MASK_WIDTH = 1200;
export const MASK_HEIGHT = 600;

const SCALE = 1.24;
const OFFSET_X = (MASK_WIDTH - (972 - 108) * SCALE) / 2;
const OFFSET_Y = (MASK_HEIGHT - (775 - 338) * SCALE) / 2;
const X = (x: number) => OFFSET_X + (x - 108) * SCALE;
// Empty margin left of the frame, as a share of the mask width (to line the frame up with text).
export const FRAME_LEFT = OFFSET_X / MASK_WIDTH;
const Y = (y: number) => OFFSET_Y + (y - 338) * SCALE;
const W = (w: number) => Math.max(w * SCALE, 12); // thinner strokes fall between ASCII cells

const FRAME_STROKE = 16;
const ARROW_SHIFT = 14; // px up-right: about one character cell
const WEIGHT = 800;

export interface LogoMasks {
  white: string;
  red: string;
  redShifted: string;
}

type Point = [number, number];

function newMask() {
  const canvas = document.createElement("canvas");
  canvas.width = MASK_WIDTH;
  canvas.height = MASK_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  return { canvas, ctx };
}

// Draws `text` so its ink spans `left`..`right` (traced coordinates) with the cap top at `top`.
function fitText(ctx: CanvasRenderingContext2D, text: string, family: string, left: number, right: number, top: number) {
  ctx.font = `${WEIGHT} 100px ${family}`;
  const probe = ctx.measureText(text);
  const size = (100 * (X(right) - X(left))) / (probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight);
  ctx.font = `${WEIGHT} ${size}px ${family}`;
  const m = ctx.measureText(text);
  ctx.fillText(text, X(left) + m.actualBoundingBoxLeft, Y(top) + m.actualBoundingBoxAscent);
}

function path(ctx: CanvasRenderingContext2D, points: Point[], width: number) {
  ctx.lineWidth = W(width);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y))));
  ctx.stroke();
}

// An arrow pointing up-right: shaft from `tail` to just short of `tip`, head as an L of two arms.
function arrow(ctx: CanvasRenderingContext2D, tail: Point, tip: Point, arm: number, width: number) {
  const back = width * 0.5;
  path(ctx, [tail, [tip[0] - back, tip[1] + back]], width);
  path(ctx, [[tip[0] - arm, tip[1]], tip, [tip[0], tip[1] + arm]], width);
}

function drawArrows(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  // Two thick arrows rising out of the bottom-left corner (the frame clips their tails).
  arrow(ctx, [100, 840], [360, 580], 55, 40);
  arrow(ctx, [190, 866], [378, 678], 48, 34);
  // Small arrows, speed dashes and the hollow circle.
  arrow(ctx, [158, 604], [215, 547], 16, 7);
  arrow(ctx, [146, 717], [203, 660], 16, 7);
  path(ctx, [[176, 640], [190, 626]], 9);
  path(ctx, [[208, 603], [219, 592]], 9);
  path(ctx, [[263, 590], [275, 578]], 9);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(X(230), Y(637), 11, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRed(family: string, shift: number): string {
  const { canvas, ctx } = newMask();
  const inset = FRAME_STROKE / 2;
  ctx.lineWidth = FRAME_STROKE;
  ctx.strokeRect(X(108) + inset, Y(338) + inset, X(972) - X(108) - FRAME_STROKE, Y(775) - Y(338) - FRAME_STROKE);
  fitText(ctx, "THE", family, 152, 282, 372);

  ctx.save();
  ctx.beginPath();
  ctx.rect(X(108) + FRAME_STROKE, Y(338) + FRAME_STROKE, X(972) - X(108) - 2 * FRAME_STROKE, Y(775) - Y(338) - 2 * FRAME_STROKE);
  ctx.clip();
  ctx.translate(shift, -shift);
  drawArrows(ctx);
  ctx.restore();
  return canvas.toDataURL("image/png");
}

function drawWhite(family: string): string {
  const { canvas, ctx } = newMask();
  fitText(ctx, "SALES", family, 290, 950, 366);
  fitText(ctx, "INC.", family, 466, 944, 590);
  return canvas.toDataURL("image/png");
}

// `family` is the CSS font-family list from next/font. The font is loaded first: the canvas would
// silently fall back to another font otherwise.
export async function drawLogoMasks(family: string): Promise<LogoMasks> {
  await document.fonts.load(`${WEIGHT} 100px ${family}`, "THESALESINC.");
  await document.fonts.ready;
  return { white: drawWhite(family), red: drawRed(family, 0), redShifted: drawRed(family, ARROW_SHIFT) };
}
