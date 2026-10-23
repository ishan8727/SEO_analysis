import { describe, expect, it, vi } from "vitest";
import { inlineForPrint, type Fetchers } from "@/lib/print-html";

const BASE = "http://web:3000";

const page = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/>
<link rel="stylesheet" href="https://fonts.example.com/evil.css"/>
<link rel="preload" href="/_next/static/media/geist.woff2" as="font" crossorigin=""/>
<link rel="modulepreload" href="/_next/static/chunks/main.js"/>
<link rel="icon" href="/favicon.ico"/>
<script src="/_next/static/chunks/webpack.js" async=""></script>
</head><body><div hidden id="S:0"><main>Report</main></div><script>$RC("B:0","S:0")</script></body></html>`;

function fetchers(): Fetchers & { text: ReturnType<typeof vi.fn>; bytes: ReturnType<typeof vi.fn> } {
  return {
    text: vi.fn(async (url: string) => {
      expect(url).toBe("http://web:3000/_next/static/chunks/app.css");
      return `@font-face{src:url(../media/geist.woff2) format("woff2")}body{background:url("data:image/png;base64,AA==")}`;
    }),
    bytes: vi.fn(async (url: string) => {
      expect(url).toBe("http://web:3000/_next/static/media/geist.woff2");
      return { mime: "font/woff2", data: Buffer.from("FONT") };
    }),
  };
}

describe("inlineForPrint", () => {
  it("inlines same-origin CSS with its fonts and drops what Moli can't load", async () => {
    const f = fetchers();
    const out = await inlineForPrint(page, BASE, f);
    expect(out).toContain(`<style>@font-face{src:url("data:font/woff2;base64,${Buffer.from("FONT").toString("base64")}") format("woff2")}`);
    expect(out).toContain('url("data:image/png;base64,AA==")'); // data URIs left alone
    expect(out).not.toMatch(/<link/); // stylesheets inlined or dropped, preloads and icons dropped
    expect(out).not.toContain("webpack.js");
    expect(out).toContain('<script>$RC("B:0","S:0")</script>'); // inline streaming scripts stay
    expect(f.text).toHaveBeenCalledTimes(1); // the off-origin stylesheet is never fetched
  });
});
