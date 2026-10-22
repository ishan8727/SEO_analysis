import { db } from "@/lib/db";
import type { ProgressStep, StepState } from "@/types";

/**
 * Sets one key of Scan.progress atomically (jobs run in parallel, so never read-modify-write
 * the whole object). The first step to start moves the scan from queued to running.
 */
export async function setStepState(scanId: string, step: ProgressStep, state: StepState): Promise<void> {
  await db.$executeRaw`
    UPDATE "Scan"
    SET progress = jsonb_set(progress, ARRAY[${step}::text], to_jsonb(${state}::text), true),
        status = CASE
          WHEN status = 'queued' AND ${state}::text = 'running' THEN 'running'::"ScanStatus"
          ELSE status
        END
    WHERE id = ${scanId}`;
}

/** Marks the whole scan failed with a message that is safe to show the user. */
export async function markScanFailed(scanId: string, userMessage: string): Promise<void> {
  await db.scan.update({
    where: { id: scanId },
    data: { status: "failed", error: userMessage, finishedAt: new Date() },
  });
}
