// Drives Moli over CDP: navigate, read the DOM, take a screenshot, print a PDF. `pnpm moli:smoke [url]`
// Needs Moli reachable at MOLI_URL (docker compose -f docker-compose.yml -f docker-compose.dev.yml up moli).
import { withPage } from "@/lib/browser";
import { assertPublicUrl } from "@/lib/ssrf";

const target = (await assertPublicUrl(process.argv[2] ?? "https://example.com")).toString();

const result = await withPage(async (page) => {
  const response = await page.goto(target, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  const h1Count = await page.evaluate(() => document.querySelectorAll("h1").length);
  const screenshot = await page.screenshot().catch((e: Error) => e);
  const pdf = await page.pdf({ format: "A4" }).catch((e: Error) => e);
  return {
    status: response?.status() ?? null,
    title,
    h1Count,
    screenshot: screenshot instanceof Error ? `error: ${screenshot.message}` : `${screenshot.byteLength} bytes`,
    pdf: pdf instanceof Error ? `error: ${pdf.message}` : `${pdf.byteLength} bytes`,
  };
});

console.log(JSON.stringify({ target, ...result }, null, 2));
process.exit();
