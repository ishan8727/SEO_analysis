// Enqueues a ping job and waits for the worker to process it. `pnpm queue:ping`
import { QueueEvents } from "bullmq";
import { enqueuePing, getScanQueue, SCAN_QUEUE } from "@/lib/queue";
import { createQueueConnection } from "@/lib/redis";

const events = new QueueEvents(SCAN_QUEUE, { connection: createQueueConnection() });
await events.waitUntilReady();
const job = await enqueuePing();
console.log(`enqueued ping job ${job.id}, waiting for the worker...`);

try {
  const result = await job.waitUntilFinished(events, 15_000);
  console.log("processed:", result);
} catch (err) {
  console.error("ping was not processed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await events.close();
  await getScanQueue().close();
  process.exit();
}
