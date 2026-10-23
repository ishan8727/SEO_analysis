import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";

// Placeholder so the Phase 2 redirect lands somewhere. Phase 4 replaces this
// with the live scan page (stepper, polling, teaser, gate).

const SCAN_ID_RE = /^[A-Za-z0-9_-]{21}$/;

export default function ScanPage({ params }: PageProps<"/scan/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-16">
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <ScanStatus params={params} />
      </Suspense>
    </main>
  );
}

async function ScanStatus({ params }: Pick<PageProps<"/scan/[id]">, "params">) {
  const { id } = await params;
  if (!SCAN_ID_RE.test(id)) notFound();
  const scan = await db.scan.findUnique({
    where: { id },
    select: { status: true, business: { select: { name: true } } },
  });
  if (!scan) notFound();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Auditing {scan.business.name}</h1>
      <p className="text-muted-foreground">Status: {scan.status}</p>
    </>
  );
}
