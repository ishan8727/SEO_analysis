import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report/ReportView";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/hash";
import { loadScanRow, SCAN_ID_RE, toReport } from "@/lib/scan-view";

// PDF source: the full report for the worker's PDF job (src/worker/jobs/pdf.ts), which fetches
// this page over the private network with INTERNAL_TOKEN and prints it on Moli. The homepage
// screenshots are left out of the PDF (print:hidden): Moli doesn't paint raster images.
export const instant = false;

export const metadata: Metadata = {
  title: "Local SEO report",
  robots: { index: false, follow: false },
};

export default async function PrintPage({ params, searchParams }: PageProps<"/report/[id]/print">) {
  const { id } = await params;
  const { token } = await searchParams;
  const { INTERNAL_TOKEN } = env();
  if (!INTERNAL_TOKEN || typeof token !== "string" || !safeEqual(token, INTERNAL_TOKEN)) notFound();
  if (!SCAN_ID_RE.test(id)) notFound();

  const row = await loadScanRow(id);
  if (!row || row.status !== "done") notFound();
  const report = toReport(row);
  const { name, address, websiteUrl } = report.business;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Local SEO report · {new Date().toISOString().slice(0, 10)}</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words">{name}</h1>
        {(address || websiteUrl) && (
          <p className="text-sm break-words text-muted-foreground">{[address, websiteUrl].filter(Boolean).join(" · ")}</p>
        )}
      </header>
      <ReportView report={report} />
    </main>
  );
}
