// Builds the raster icons from src/app/icon.svg (the favicon modern browsers use):
//   src/app/apple-icon.png  180×180, for iPhone home screens (iOS doesn't take SVG icons)
//   src/app/favicon.ico     16, 32 and 48 px, for browsers and tools that only ask for /favicon.ico
// Run after changing icon.svg:   pnpm icons:build
import fs from "node:fs";
import sharp from "sharp";

const SVG = fs.readFileSync("src/app/icon.svg");
const png = (size: number) => sharp(SVG, { density: 72 * (size / 64) * 4 }).resize(size, size).png().toBuffer();

/** An .ico holding PNG images: a 6-byte header, a 16-byte entry per image, then the PNGs. */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

fs.writeFileSync("src/app/apple-icon.png", await png(180));
const sizes = [16, 32, 48];
fs.writeFileSync("src/app/favicon.ico", ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size) })))));
console.log("wrote src/app/apple-icon.png and src/app/favicon.ico");
