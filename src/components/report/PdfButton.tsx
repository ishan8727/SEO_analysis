"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { DotsLoader } from "@/components/loader/DotsLoader";
import { buttonVariants } from "@/components/ui/button";

const POLL_MS = 3_000;
const GIVE_UP_MS = 3 * 60_000;

/**
 * "Download PDF". The PDF is made by the worker right after the visitor verifies, so it can be
 * missing for a few seconds: poll GET /api/scans/:id until `pdfUrl` shows up.
 */
export function PdfButton({ scanId, pdfUrl: initialUrl }: { scanId: string; pdfUrl: string | null }) {
  const [pdfUrl, setPdfUrl] = useState(initialUrl);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (pdfUrl) return;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
        const data = res.ok ? ((await res.json()) as { pdfUrl?: string | null }) : null;
        if (cancelled) return;
        if (data?.pdfUrl) return setPdfUrl(data.pdfUrl);
      } catch {
        // keep trying until GIVE_UP_MS
      }
      if (Date.now() - startedAt > GIVE_UP_MS) return setGaveUp(true);
      timer = setTimeout(poll, POLL_MS);
    }
    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanId, pdfUrl]);

  if (pdfUrl) {
    return (
      <a href={pdfUrl} className={buttonVariants({ variant: "outline" })}>
        <Download aria-hidden /> Download PDF
      </a>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      {gaveUp ? (
        "Your PDF isn't ready yet. Refresh the page in a minute."
      ) : (
        <>
          <DotsLoader className="text-primary" /> Preparing your PDF…
        </>
      )}
    </p>
  );
}
