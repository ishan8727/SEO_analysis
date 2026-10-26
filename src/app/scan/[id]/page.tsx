import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Gate } from "@/components/scan/Gate";
import { ScanLive } from "@/components/scan/ScanLive";
import { env } from "@/lib/env";
import { loadScanRow, toLocked, toReport } from "@/lib/scan-view";
import { unlockCookieName, verifyUnlock } from "@/lib/unlock";

// Live scan page (SPEC.md section 9). Renders the current state on the server, then
// ScanLive polls the API. A visitor who hasn't verified their phone gets status only (no results in
// the HTML or the API); the finished scan shows a locked wall with the gate in a pop-up. `instant = false`: the page reads the scan before rendering anything
// (no Suspense of its own). The layout shell still streams first, so an unknown id renders the
// not-found page (noindex) with HTTP 200; see TODO.md.
export const instant = false;

export const metadata: Metadata = {
  title: "Your local SEO audit",
  robots: { index: false, follow: false },
};

export default async function ScanPage({ params }: PageProps<"/scan/[id]">) {
  const { id } = await params;
  const row = await loadScanRow(id);
  if (!row) notFound();

  // verifyUnlock reads Date.now() for expiry; that must happen at request time, not in a prerender.
  await connection();
  const unlocked = verifyUnlock((await cookies()).get(unlockCookieName(id))?.value, id) !== null;
  const initial = unlocked ? toReport(row) : toLocked(row);
  const { name, address, websiteUrl } = initial.business;

  return (
    // Dark brand theme over the ASCII background; top padding clears the fixed logo (ScanLive).
    <main className="dark brand-theme mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-28 pb-10 text-foreground sm:pb-16 md:pt-36">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Local SEO audit</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{name}</h1>
        {(address || websiteUrl) && (
          <p className="text-sm break-words text-muted-foreground">{[address, websiteUrl].filter(Boolean).join(" · ")}</p>
        )}
      </header>
      <ScanLive
        key={unlocked ? "unlocked" : "locked"}
        initial={initial}
        gate={
          !unlocked && (
            <Gate scanId={id} countryCode={initial.countryCode} defaultCountry={env().DEFAULT_COUNTRY} />
          )
        }
      />
    </main>
  );
}
