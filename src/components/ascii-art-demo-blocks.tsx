"use client";
import { AsciiArt } from "@/components/ui/ascii-art";

export default function AsciiArtBlocksDemo() {
  return (
    <AsciiArt
      src="https://assets.aceternity.com/avatars/manu.webp"
      resolution={80}
      charset="blocks"
      color="#a855f7"
      inverted
      animated={false}
      className="mx-auto aspect-square w-full max-w-lg bg-neutral-950"
    />
  );
}
