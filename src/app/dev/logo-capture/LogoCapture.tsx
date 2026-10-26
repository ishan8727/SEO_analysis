"use client";

import { useSearchParams } from "next/navigation";
import { AsciiLogoSource, type LogoVariant } from "@/components/landing/AsciiLogoSource";

// ?variant=hero|compact&hover=1. Transparent page so the screenshots keep only the logo.
export function LogoCapture() {
  const params = useSearchParams();
  const variant: LogoVariant = params.get("variant") === "compact" ? "compact" : "hero";
  return (
    <>
      <style>{"html, body { background: transparent !important; margin: 0; }"}</style>
      <div className="p-0">
        <AsciiLogoSource variant={variant} forceHover={params.get("hover") === "1"} />
      </div>
    </>
  );
}
