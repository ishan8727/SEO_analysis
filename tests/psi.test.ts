import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePsi, PsiError, runPsi } from "@/lib/google/psi";
import fixture from "./fixtures/psi-mobile.json";

afterEach(() => vi.unstubAllGlobals());

describe("parsePsi", () => {
  const run = parsePsi(fixture);

  it("extracts category scores and Core Web Vitals", () => {
    expect(run.result).toMatchObject({
      performance: 0.62,
      seo: 0.83,
      bestPractices: 0.96,
      accessibility: 0.88,
      cwv: { lcpMs: 4210.5, cls: 0.041, inpMs: 240, fcpMs: 2101.2, tbtMs: 312 },
      cwvPass: false,
      viewport: true,
    });
    expect(run.finalUrl).toBe("https://sharmadental.example.in/");
  });

  it("lists failing SEO audits, ignoring passed, not-applicable and manual ones", () => {
    expect(run.result.failingSeoAudits).toEqual([
      { id: "meta-description", title: "Document does not have a meta description" },
      { id: "image-alt", title: "Image elements do not have `[alt]` attributes" },
    ]);
  });

  it("decodes the final screenshot", () => {
    expect(run.screenshot?.mime).toBe("image/jpeg");
    expect([...run.screenshot!.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it("copes with no field data, the legacy viewport audit and missing categories", () => {
    const sparse = parsePsi({
      lighthouseResult: { categories: {}, audits: { viewport: { score: 1 } } },
    });
    expect(sparse.result).toMatchObject({ performance: null, cwvPass: null, viewport: true, failingSeoAudits: [] });
    expect(sparse.result.cwv.inpMs).toBeNull();
    expect(sparse.screenshot).toBeNull();
  });
});

describe("runPsi", () => {
  it("requests one strategy with all four categories", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture));
    vi.stubGlobal("fetch", fetchMock);

    await runPsi("https://sharmadental.example.in/", "desktop");

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    expect(url.searchParams.get("url")).toBe("https://sharmadental.example.in/");
    expect(url.searchParams.get("strategy")).toBe("desktop");
    expect(url.searchParams.getAll("category")).toEqual(["performance", "seo", "best-practices", "accessibility"]);
    expect(url.searchParams.get("key")).toBe("test-server-key");
  });

  it("throws PsiError without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 })),
    );
    const err = await runPsi("https://example.com/", "mobile").then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(PsiError);
    expect(err?.message).toBe("PSI mobile failed: 429 RESOURCE_EXHAUSTED");
    expect(err?.message).not.toContain("test-server-key");
  });
});
