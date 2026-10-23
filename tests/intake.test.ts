import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { createScanSchema, siteOrigin, withScheme } from "@/lib/intake";
import { verifyTurnstile } from "@/lib/turnstile";

afterEach(() => vi.unstubAllGlobals());

describe("createScanSchema", () => {
  it("accepts local and online requests", () => {
    expect(createScanSchema.safeParse({ mode: "local", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4", turnstileToken: "t" }).success).toBe(true);
    expect(createScanSchema.safeParse({ mode: "online", url: "example.com", turnstileToken: "t" }).success).toBe(true);
  });

  it.each([
    { mode: "local", placeId: "short", turnstileToken: "t" },
    { mode: "local", placeId: "ChIJ<script>alert(1)</script>", turnstileToken: "t" },
    { mode: "local", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" },
    { mode: "online", url: "", turnstileToken: "t" },
    { mode: "online", url: `https://example.com/${"a".repeat(2100)}`, turnstileToken: "t" },
    { mode: "other", turnstileToken: "t" },
    null,
  ])("rejects %j", (body) => {
    expect(createScanSchema.safeParse(body).success).toBe(false);
  });
});

describe("url helpers", () => {
  it("adds https:// only when no scheme was given", () => {
    expect(withScheme(" mysite.in ")).toBe("https://mysite.in");
    expect(withScheme("http://mysite.in/x")).toBe("http://mysite.in/x");
    expect(withScheme("ftp://mysite.in")).toBe("ftp://mysite.in"); // rejected later by parsePublicUrl
  });

  it("keys a website by scheme + lowercase host", () => {
    expect(siteOrigin(new URL("https://WWW.MySite.in/menu?x=1"))).toBe("https://www.mysite.in");
  });
});

describe("categories", () => {
  it("have unique ids, at most 5 primary types each, and an 'other' fallback", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIES) {
      expect(c.primaryTypes.length).toBeLessThanOrEqual(5);
      for (const t of c.primaryTypes) expect(t).toMatch(/^[a-z_]+$/);
    }
    expect(CATEGORIES.find((c) => c.id === "other")?.primaryTypes).toEqual([]);
  });
});

describe("verifyTurnstile", () => {
  it("passes only on success: true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile("tok", "1.2.3.4", "secret")).toBe(true);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("fails closed on rejection, HTTP error, network error and missing secret", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false, "error-codes": ["invalid-input-response"] })));
    expect(await verifyTurnstile("tok", "ip", "secret")).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    expect(await verifyTurnstile("tok", "ip", "secret")).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await verifyTurnstile("tok", "ip", "secret")).toBe(false);

    expect(await verifyTurnstile("tok", "ip", "")).toBe(false);
  });
});
