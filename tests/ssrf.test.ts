import type dns from "node:dns";
import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPublicAddress, parsePublicUrl, SsrfError } from "@/lib/ssrf";

function fakeLookup(addresses: string[]) {
  return ((_host: string, _opts: unknown, cb: (err: null, addrs: dns.LookupAddress[]) => void) =>
    cb(
      null,
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    )) as unknown as typeof dns.lookup;
}

describe("isPublicAddress", () => {
  it.each([
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "64:ff9b::a00:1", // NAT64 → 10.0.0.1
    "not-an-ip",
  ])("rejects %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["93.184.215.14", "8.8.8.8", "2606:4700:4700::1111"])("accepts %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );
});

describe("parsePublicUrl", () => {
  it.each([
    ["ftp://example.com", "INVALID_URL"],
    ["javascript:alert(1)", "INVALID_URL"],
    ["http://user:pass@example.com", "INVALID_URL"],
    ["http://example.com:8080", "INVALID_URL"],
    [`https://example.com/${"a".repeat(2100)}`, "INVALID_URL"],
    ["http://10.0.0.1", "BLOCKED_HOST"],
    ["http://[::1]/", "BLOCKED_HOST"],
    ["http://2130706433/", "BLOCKED_HOST"], // decimal form of 127.0.0.1
    ["http://localhost:80", "BLOCKED_HOST"],
    ["https://maps.google.com/x", "BLOCKED_HOST"],
    ["https://www.facebook.com/page", "BLOCKED_HOST"],
    // GCE metadata server: hands out the VM's service-account token
    ["http://metadata.google.internal/computeMetadata/v1/", "BLOCKED_HOST"],
    ["http://metadata.google.internal./", "BLOCKED_HOST"],
    ["http://169.254.169.254/computeMetadata/v1/", "BLOCKED_HOST"],
    ["http://[fd20:ce::254]/", "BLOCKED_HOST"],
    ["http://intranet/", "BLOCKED_HOST"],
  ])("rejects %s (%s)", (raw, reason) => {
    try {
      parsePublicUrl(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfError);
      expect((err as SsrfError).reason).toBe(reason);
    }
  });

  it("accepts a normal business website", () => {
    expect(parsePublicUrl("https://www.example.in/menu?x=1").hostname).toBe("www.example.in");
  });
});

describe("assertPublicUrl", () => {
  it("rejects a hostname that resolves to a private address (DNS rebinding style)", async () => {
    await expect(assertPublicUrl("https://evil.example", fakeLookup(["93.184.215.14", "10.0.0.5"]))).rejects.toMatchObject({
      reason: "PRIVATE_ADDRESS",
    });
  });

  it("rejects a hostname that resolves to the metadata server", async () => {
    await expect(assertPublicUrl("https://meta.example", fakeLookup(["169.254.169.254"]))).rejects.toMatchObject({
      reason: "PRIVATE_ADDRESS",
    });
  });

  it("accepts a hostname whose addresses are all public", async () => {
    const url = await assertPublicUrl("https://ok.example", fakeLookup(["93.184.215.14"]));
    expect(url.hostname).toBe("ok.example");
  });
});
