"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { SalesAsciiBackground } from "@/components/landing/SalesAsciiBackground";
import { SalesAsciiLogo } from "@/components/landing/SalesAsciiLogo";
import { SalesLoader } from "@/components/loader/SalesLoader";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FixList } from "./FixList";
import { PillarBars } from "./PillarBars";
import { ResultsWall } from "./ResultsWall";
import { ScanProgress } from "./ScanProgress";
import { ScoreRing } from "./ScoreRing";
import { Screenshots } from "./Screenshots";
import { useScanPolling, type ScanPayload } from "./useScanPolling";
import { STEPS_BY_MODE, type ProgressStep } from "@/types";

const TOP_FIXES = 5; // SPEC.md section 11: top 5 fixes on the scan page; all of them in the report

// Share of the audit's steps that are over (a running step counts half), for the loader.
function auditProgress(scan: ScanPayload): number {
  const steps: ProgressStep[] = [...STEPS_BY_MODE[scan.mode], "finalize"];
  const score = steps.reduce((sum, step) => {
    const state = scan.progress[step];
    return sum + (state === "running" ? 0.5 : state && state !== "pending" ? 1 : 0);
  }, 0);
  return score / steps.length;
}

/**
 * Live scan page body. Verified: stepper, then the results as they come in. Not verified: the
 * payload has no results (ScanLocked), so the page shows progress, then a locked wall with the
 * gate (Gate.tsx, passed in as `gate`) in a pop-up.
 */
export function ScanLive({ initial, gate }: { initial: ScanPayload; gate?: ReactNode }) {
  const scan = useScanPolling(initial);
  const done = scan.status === "done";
  // Loader over the page until the results are in; not for a scan that was already finished. The
  // background sits dim underneath and settles, and the compact logo appears, once it's gone.
  const [withLoader] = useState(initial.status !== "done" && initial.status !== "failed");
  const [loaded, setLoaded] = useState(!withLoader);
  const loader = withLoader && (
    <SalesLoader
      progress={auditProgress(scan)}
      complete={done || scan.status === "failed"}
      onComplete={() => setLoaded(true)}
    />
  );
  const backdrop = (
    <>
      <SalesAsciiBackground active={loaded} />
      {loaded && <SalesAsciiLogo variant="compact" />}
    </>
  );

  // While the loader covers the page, render nothing under it: hidden spinners and skeleton sweeps
  // would keep animating for the whole audit. The content mounts as soon as the scan finishes, while
  // the loader plays its closing sweep and fade.
  if (withLoader && !loaded && !done && scan.status !== "failed") {
    return (
      <>
        {loader}
        {backdrop}
      </>
    );
  }

  if (scan.status === "failed") {
    return (
      <>
        {loader}
        {backdrop}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-red-600" aria-hidden />
              This audit didn&apos;t finish
            </CardTitle>
            <CardDescription>{scan.error ?? "Something went wrong. Please try again in a few minutes."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className={buttonVariants({ variant: "outline" })}>
              Start a new audit
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  // Not verified: status only until the audit is done, then the locked wall with the gate pop-up.
  if (scan.verification === "not_verified") {
    return (
      <>
        {loader}
        {backdrop}
        <div className="flex flex-col gap-4">
          {done ? <ResultsWall mode={scan.mode} gate={gate} ready={loaded} /> : <ProgressCard scan={scan} />}
        </div>
      </>
    );
  }

  const pillars = scan.score?.pillars ?? scan.partialPillars ?? {};
  const rank = scan.score?.rank;
  const psiState = scan.progress.psi ?? (scan.mode === "online" || scan.business.websiteUrl ? "pending" : "skipped");

  // Loader and backdrop lead a fragment in every return, so they keep the same instances throughout.
  return (
    <>
      {loader}
      {backdrop}
      <div className="flex flex-col gap-4">
        {!done && <ProgressCard scan={scan} />}

        {done && (
          <Link href={`/report/${scan.id}`} className={buttonVariants({ size: "lg", className: "w-full" })}>
            Open your full report <ArrowRight aria-hidden />
          </Link>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your score</CardTitle>
            {rank && (
              <CardDescription>
                You rank <span className="font-medium text-foreground">#{rank.position}</span> of {rank.of} nearby
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <ScoreRing score={scan.score?.total ?? null} grade={scan.score?.grade ?? null} className="shrink-0" />
            <PillarBars pillars={pillars} mode={scan.mode} />
          </CardContent>
        </Card>

        {(psiState === "pending" || psiState === "running" || scan.screenshots.mobile || scan.screenshots.desktop) && (
          <Card>
            <CardHeader>
              <CardTitle>Your homepage</CardTitle>
            </CardHeader>
            <CardContent>
              <Screenshots shots={scan.screenshots} psiState={psiState} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>What to fix first</CardTitle>
            {done && <CardDescription>Ranked by points gained for the effort.</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!done ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : scan.fixes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing major to fix. Nice work.</p>
            ) : (
              <FixList fixes={scan.fixes.slice(0, TOP_FIXES)} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ProgressCard({ scan }: { scan: ScanPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Running your audit</CardTitle>
        <CardDescription>This takes about a minute. You can keep this page open.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScanProgress mode={scan.mode} progress={scan.progress} status={scan.status} />
      </CardContent>
    </Card>
  );
}
