import { chromium, type Browser, type Page } from "playwright-core";

// Moli (Rust headless browser) over CDP, behind its token gate. See docker/moli/.
// One CDP connection per job; always closed in finally. Phase 3 adds the cheerio fallback
// in jobs/dom-audit.ts; Phase 5 uses withPage() for the PDF.

export const MOLI_JOB_TIMEOUT_MS = 45_000;

const moliUrl = () => process.env.MOLI_URL ?? "http://localhost:9222";
const authHeaders = () => ({ Authorization: `Bearer ${process.env.MOLI_TOKEN ?? ""}` });

export async function connectMoli(): Promise<Browser> {
  return chromium.connectOverCDP(moliUrl(), { headers: authHeaders(), timeout: 15_000 });
}

/**
 * Runs `fn` with a fresh page and a hard timeout. The browser connection is closed
 * whatever happens. Navigate only to URLs that passed assertPublicUrl() (src/lib/ssrf.ts).
 */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  timeoutMs = MOLI_JOB_TIMEOUT_MS,
): Promise<T> {
  const browser = await connectMoli();
  let timer: NodeJS.Timeout | undefined;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Moli job timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    return await Promise.race([fn(page), timeout]);
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => {});
  }
}

/** Health probe: GET /json/version through the token gate. */
export async function moliStatus(timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(`${moliUrl()}/json/version`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
