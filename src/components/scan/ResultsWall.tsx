"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Lock, XIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Locked, PlaceholderLines, PlaceholderScore } from "./Locked";

const UNLOCK_LABEL = "Verify to view";
/** After the loader: the cards rise in and the placeholders fill (globals.css .wall-*), then the pop-up. */
const POPUP_DELAY_MS = 1700;
const POPUP_DELAY_REDUCED_MS = 300;

/**
 * What a visitor who hasn't verified sees once the audit is done, in three beats: the loader
 * finishes, the locked results come in card by card (placeholders only; no results were sent, see
 * ScanLocked in src/types.ts), then the phone gate rises in a pop-up. Closing the pop-up leaves the
 * wall; any "Verify to view" reopens it at once.
 *
 * The pop-up is non-modal on purpose: a modal dialog makes everything outside it inert and traps
 * focus, which breaks the reCAPTCHA challenge Firebase injects into <body>. Our own backdrop blocks
 * the page instead, and outside presses don't close it (they'd fire on the challenge too).
 * keepMounted keeps the gate's state (sent code, countdown) when it's closed and reopened.
 */
export function ResultsWall({ mode, gate, ready }: { mode: "local" | "online"; gate: ReactNode; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const unlock = () => setOpen(true);

  // `ready` turns true once, when the loader is gone; the pop-up follows once the wall has settled.
  useEffect(() => {
    if (!ready) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setOpen(true), reduced ? POPUP_DELAY_REDUCED_MS : POPUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  // Nothing under the loader: the entrance animations should play in view, not behind its fade.
  if (!ready) return null;

  const lock = { label: UNLOCK_LABEL, onUnlock: unlock, className: "wall-lock" };
  return (
    <>
      <Card className="wall-in" style={wallIndex(0)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4 text-primary" aria-hidden /> Your results are ready
          </CardTitle>
          <CardDescription>Verify your mobile number to view your score, every fix and the full report.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" className="w-full" onClick={unlock}>
            {UNLOCK_LABEL}
          </Button>
        </CardContent>
      </Card>

      <WallCard index={1} title="Your score">
        <Locked {...lock}>
          <PlaceholderScore mode={mode} animated />
        </Locked>
      </WallCard>
      <WallCard index={2} title="What to fix first" description="Ranked by points gained for the effort.">
        <Locked {...lock}>
          <PlaceholderLines rows={5} />
        </Locked>
      </WallCard>
      {mode === "local" && (
        <>
          <WallCard index={3} title="Nearby competitors" description="Who you're up against, with their ratings and reviews.">
            <Locked {...lock}>
              <PlaceholderLines rows={4} />
            </Locked>
          </WallCard>
          <WallCard index={4} title="What your reviews say" description="What customers love and what they complain about.">
            <Locked {...lock}>
              <PlaceholderLines rows={3} />
            </Locked>
          </WallCard>
        </>
      )}

      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false} disablePointerDismissal>
        <DialogPrimitive.Portal keepMounted>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm duration-300 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          {/* Portaled outside <main>, so the popup carries the dark brand scope itself. */}
          <DialogPrimitive.Popup className="dark brand-theme fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl text-sm text-foreground shadow-[0_0_60px_-12px_rgb(251_43_47/45%)] outline-none ease-out sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-8 data-open:zoom-in-95 data-open:duration-400 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-200">
            <DialogPrimitive.Title className="sr-only">Verify your number to view your results</DialogPrimitive.Title>
            <div className="[&_[data-slot=card]]:bg-black/85 [&_[data-slot=card]]:ring-primary/30">{gate}</div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
            >
              <XIcon aria-hidden />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

/** Position in the entrance stagger (globals.css .wall-in reads --wall-i). */
function wallIndex(i: number): CSSProperties {
  return { ["--wall-i" as string]: i };
}

function WallCard({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="wall-in" style={wallIndex(index)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
