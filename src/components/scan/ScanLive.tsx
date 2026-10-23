"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FixList } from "./FixList";
import { Locked, PlaceholderLines } from "./Locked";
import { PillarBars } from "./PillarBars";
import { ScanProgress } from "./ScanProgress";
import { ScoreRing } from "./ScoreRing";
import { Screenshots } from "./Screenshots";
import { useScanPolling, type ScanPayload } from "./useScanPolling";

const LOCKED_PREVIEW_ROWS = 3; // SPEC.md section 11: top 5 fixes, 3 locked

/** Live scan page body: stepper, teaser that fills in as steps finish, locked sections, gate slot. */
export function ScanLive({ initial, gate }: { initial: ScanPayload; gate?: ReactNode }) {
  const scan = useScanPolling(initial);
  const done = scan.status === "done";

  if (scan.status === "failed") {
    return (
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
    );
  }

  const pillars = scan.score?.pillars ?? scan.partialPillars ?? {};
  const rank = scan.score?.rank;
  const psiState = scan.progress.psi ?? (scan.mode === "online" || scan.business.websiteUrl ? "pending" : "skipped");

  return (
    <div className="flex flex-col gap-4">
      {!done && (
        <Card>
          <CardHeader>
            <CardTitle>Running your audit</CardTitle>
            <CardDescription>This takes about a minute. You can keep this page open.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScanProgress mode={scan.mode} progress={scan.progress} status={scan.status} />
          </CardContent>
        </Card>
      )}

      {scan.unlocked && done && (
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
          ) : scan.fixesPreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing major to fix. Nice work.</p>
          ) : (
            <>
              <FixList fixes={scan.fixesPreview} />
              {!scan.unlocked && scan.lockedFixCount > 0 && (
                <Locked label={`${scan.lockedFixCount} more fixes in the full report`}>
                  <PlaceholderLines rows={Math.min(LOCKED_PREVIEW_ROWS, scan.lockedFixCount)} />
                </Locked>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {scan.mode === "local" && !scan.unlocked && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Nearby competitors</CardTitle>
              <CardDescription>Who you&apos;re up against, with their ratings and reviews.</CardDescription>
            </CardHeader>
            <CardContent>
              <Locked label="Competitor names in the full report">
                <PlaceholderLines rows={4} />
              </Locked>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>What your reviews say</CardTitle>
              <CardDescription>What customers love and what they complain about.</CardDescription>
            </CardHeader>
            <CardContent>
              <Locked label="Review insights in the full report">
                <PlaceholderLines rows={3} />
              </Locked>
            </CardContent>
          </Card>
        </>
      )}

      {/* Lead gate (Gate.tsx): phone verification with Firebase. */}
      {!scan.unlocked && gate}
    </div>
  );
}
