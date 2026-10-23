import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SalesAsciiBackground } from "@/components/landing/SalesAsciiBackground";
import { SalesAsciiLogo } from "@/components/landing/SalesAsciiLogo";
import { ReportView } from "@/components/report/ReportView";
import { loadScanRow, SCAN_ID_RE, toReport } from "@/lib/scan-view";
import { unlockCookieName, verifyUnlock } from "@/lib/unlock";

// Full report, unlocked visitors only. `instant = false`: the page checks the unlock cookie
// before rendering anything. The layout shell still streams first, so the redirect to
// /scan/[id] happens client-side (HTTP 200) and no report data is sent; see TODO.md.
export const instant = false;

export const metadata: Metadata = {
  title: "Your full local SEO report",
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params }: PageProps<"/report/[id]">) {
  const { id } = await params;
  if (!SCAN_ID_RE.test(id)) notFound();
  if (!verifyUnlock((await cookies()).get(unlockCookieName(id))?.value, id)) redirect(`/scan/${id}`);

  const row = await loadScanRow(id);
  if (!row) notFound();
  if (row.status !== "done") redirect(`/scan/${id}`);
  const report = toReport(row);
  const { name, address, websiteUrl } = report.business;

  // Dark brand theme over the ASCII background, like the scan page. The print page (the PDF) renders
  // ReportView without these, so it stays light.
  return (
    <main className="dark brand-theme mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-28 pb-10 text-foreground sm:pb-16 md:pt-36">
      <SalesAsciiBackground />
      <SalesAsciiLogo variant="compact" />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Full local SEO report</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{name}</h1>
        {(address || websiteUrl) && (
          <p className="text-sm break-words text-muted-foreground">{[address, websiteUrl].filter(Boolean).join(" · ")}</p>
        )}
      </header>
      <ReportView report={report} />
    </main>
  );
}
