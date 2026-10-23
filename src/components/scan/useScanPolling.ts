"use client";

import { useEffect, useState } from "react";
import type { ScanReport, ScanTeaser } from "@/types";

const FAST_MS = 2_000;
const SLOW_MS = 5_000;
const SLOW_AFTER_MS = 30_000;

export type ScanPayload = ScanTeaser | ScanReport;

const finished = (s: ScanPayload) => s.status === "done" || s.status === "failed";

/**
 * Polls GET /api/scans/:id every 2 s, every 5 s after 30 s, and stops once the scan is
 * done or failed (SPEC.md section 9). Honours Retry-After on 429; stops on 404.
 */
export function useScanPolling(initial: ScanPayload): ScanPayload {
  const [scan, setScan] = useState(initial);

  useEffect(() => {
    if (finished(initial)) return;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(poll, ms);
    };
    const nextDelay = () => (Date.now() - startedAt > SLOW_AFTER_MS ? SLOW_MS : FAST_MS);

    async function poll() {
      try {
        const res = await fetch(`/api/scans/${initial.id}`, { cache: "no-store" });
        if (res.status === 404) return;
        if (res.status === 429) {
          schedule(Number(res.headers.get("Retry-After") ?? 10) * 1000);
          return;
        }
        if (!res.ok) return schedule(SLOW_MS);
        const next = (await res.json()) as ScanPayload;
        if (cancelled) return;
        setScan(next);
        if (!finished(next)) schedule(nextDelay());
      } catch {
        schedule(SLOW_MS); // offline or a blip: keep trying, slowly
      }
    }

    schedule(FAST_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initial]);

  return scan;
}
