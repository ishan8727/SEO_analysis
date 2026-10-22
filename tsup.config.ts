import { defineConfig } from "tsup";

// Bundles the BullMQ worker into dist-worker/index.mjs. Dependencies stay external:
// the runtime image ships the full production node_modules.
export default defineConfig({
  entry: { index: "src/worker/index.ts" },
  outDir: "dist-worker",
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
});
