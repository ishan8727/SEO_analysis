import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

function directive(csp: string, name: string): string[] {
  const part = csp.split("; ").find((d) => d.startsWith(`${name} `));
  return part ? part.split(" ").slice(1) : [];
}

describe("security headers", () => {
  const prod = contentSecurityPolicy({ isDev: false, firebaseAuthDomain: "demo.firebaseapp.com" });

  it("locks down framing, plugins and base/form targets", () => {
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
  });

  it("allows the third parties each feature needs", () => {
    expect(directive(prod, "script-src")).toEqual(
      expect.arrayContaining([
        "https://maps.googleapis.com",
        "https://challenges.cloudflare.com",
        "https://www.google.com/recaptcha/",
        "https://www.gstatic.com/recaptcha/",
      ]),
    );
    expect(directive(prod, "connect-src")).toEqual(
      expect.arrayContaining(["https://places.googleapis.com", "https://identitytoolkit.googleapis.com"]),
    );
    expect(directive(prod, "frame-src")).toContain("https://demo.firebaseapp.com");
    expect(directive(prod, "img-src")).toContain("https://tile.openstreetmap.org");
  });

  it("allows eval and the HMR socket only in dev", () => {
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(prod, "connect-src")).not.toContain("ws:");
    const dev = contentSecurityPolicy({ isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
  });

  it("sends HSTS only from production builds", () => {
    const keys = (isDev: boolean) => securityHeaders({ isDev }).map((h) => h.key);
    expect(keys(false)).toContain("Strict-Transport-Security");
    expect(keys(true)).not.toContain("Strict-Transport-Security");
    expect(keys(false)).toEqual(
      expect.arrayContaining(["Content-Security-Policy", "X-Frame-Options", "Referrer-Policy", "X-Content-Type-Options"]),
    );
  });
});
