import { describe, expect, it } from "vitest";
import { hashIdentifier, safeEqual } from "@/lib/hash";
import { signUnlock, UNLOCK_TTL_SEC, verifyUnlock } from "@/lib/unlock";

describe("unlock cookie", () => {
  const now = Date.UTC(2026, 9, 22);

  it("round-trips for the same scan", () => {
    const token = signUnlock("scan_abc", "lead_1", now);
    expect(verifyUnlock(token, "scan_abc", now)).toMatchObject({ scanId: "scan_abc", leadId: "lead_1" });
  });

  it("rejects another scan, tampering, expiry and garbage", () => {
    const token = signUnlock("scan_abc", "lead_1", now);
    expect(verifyUnlock(token, "scan_other", now)).toBeNull();

    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ scanId: "scan_abc", leadId: "x", exp: 9e9 })).toString("base64url");
    expect(verifyUnlock(`${forged}.${sig}`, "scan_abc", now)).toBeNull();
    expect(verifyUnlock(`${payload}.${sig}x`, "scan_abc", now)).toBeNull();

    expect(verifyUnlock(token, "scan_abc", now + UNLOCK_TTL_SEC * 1000 + 1)).toBeNull();
    expect(verifyUnlock(undefined, "scan_abc", now)).toBeNull();
    expect(verifyUnlock("not-a-token", "scan_abc", now)).toBeNull();
  });
});

describe("hash helpers", () => {
  it("hashIdentifier is deterministic and does not leak the input", () => {
    expect(hashIdentifier("1.2.3.4")).toBe(hashIdentifier("1.2.3.4"));
    expect(hashIdentifier("1.2.3.4")).not.toBe(hashIdentifier("1.2.3.5"));
    expect(hashIdentifier("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("safeEqual compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
