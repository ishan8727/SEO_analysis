import { describe, expect, it } from "vitest";
import { getClientIp } from "@/lib/api";

// In production the edge Caddy overwrites X-Real-IP with the connecting address
// (deploy/seo-audit.caddy), so the value it sets is the one that counts.
function req(headers: Record<string, string>) {
  return new Request("https://audit.example/api/scans", { headers });
}

describe("getClientIp", () => {
  it("uses X-Real-IP (set by the edge proxy)", () => {
    expect(getClientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });

  it("ignores client-supplied X-Forwarded-For hops before the proxy's own", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("falls back to unknown without proxy headers", () => {
    expect(getClientIp(req({}))).toBe("unknown");
  });
});
