import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LogoCapture } from "./LogoCapture";

// Dev only: the live ASCII logo on a transparent page, filmed by scripts/make-logo-animation.ts
// (pnpm logo:build). 404 in production builds.
export default function LogoCapturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <LogoCapture />
    </Suspense>
  );
}
