import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toPlaceSnapshot } from "@/lib/google/places";
import { extractPage, napMatch, robotsAllows, robotsSitemaps } from "@/lib/page-audit";
import placeFixture from "./fixtures/place-details.json";

const html = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("extractPage", () => {
  it("reads a well-built local business page", () => {
    const { facts } = extractPage(html("page-local.html"), "https://sharmadental.example.in/");
    expect(facts).toEqual({
      title: "Sharma Dental Care | Dentist in Indiranagar, Bengaluru",
      metaDescription: "Family dental clinic on MG Road, Indiranagar. Book an appointment today.",
      canonical: "https://sharmadental.example.in/",
      robotsMeta: "index, follow",
      viewport: true,
      h1Count: 1,
      h2Count: 2,
      jsonLdTypes: ["WebSite", "Dentist", "MedicalClinic", "PostalAddress"],
      hasLocalSchema: true,
      ogTags: { "og:title": "Sharma Dental Care", "og:image": "https://sharmadental.example.in/og.jpg" },
      images: { total: 3, missingAlt: 2 },
      links: { internal: 3, external: 1, tel: 1, whatsapp: 1, maps: 2 },
      // "Order now" only appears inside a <script>, so it doesn't count.
      keywordHits: { ordering: false, booking: true },
    });
  });

  it("reads a bare page", () => {
    const { facts } = extractPage(html("page-basic.html"), "https://ourshop.example.in/");
    expect(facts).toMatchObject({
      title: null,
      metaDescription: null,
      canonical: null,
      robotsMeta: null,
      viewport: false,
      h1Count: 0,
      h2Count: 1,
      jsonLdTypes: [],
      hasLocalSchema: false,
      ogTags: {},
      images: { total: 1, missingAlt: 1 },
      links: { internal: 0, external: 1, tel: 0, whatsapp: 0, maps: 0 },
      keywordHits: { ordering: true, booking: false },
    });
  });

  it("returns visible text without script or style content", () => {
    const { text } = extractPage(html("page-local.html"), "https://sharmadental.example.in/");
    expect(text).toContain("12, MG Road, Indiranagar");
    expect(text).not.toContain("document.write");
    expect(text).not.toContain(".hero");
  });
});

describe("napMatch", () => {
  const snapshot = toPlaceSnapshot(placeFixture);

  it("matches name, address and phone written differently", () => {
    const { text } = extractPage(html("page-local.html"), "https://sharmadental.example.in/");
    expect(napMatch(text, snapshot)).toEqual({ name: 1, address: 1, phone: 1, score: 1 });
  });

  it("scores partial overlap", () => {
    const { text } = extractPage(html("page-basic.html"), "https://ourshop.example.in/");
    const place = {
      name: "Gupta Sweets",
      formattedAddress: "Shop 4, Chandni Chowk, Delhi 110006",
      nationalPhoneNumber: "011 2345 6789",
    };
    expect(napMatch(text, place)).toEqual({ name: 0.5, address: 0.2, phone: 0, score: 0.23 });
  });

  it("leaves parts Google has no data for out of the score", () => {
    const place = { name: "Gupta Sweets", formattedAddress: null, nationalPhoneNumber: null };
    expect(napMatch("Gupta Sweets, since 1950", place)).toEqual({ name: 1, address: 0, phone: 0, score: 1 });
  });
});

describe("robots.txt", () => {
  const txt = [
    "# comment",
    "User-agent: *",
    "Disallow: /private",
    "Allow: /private/ok$",
    "Disallow: /*.pdf$",
    "Disallow:",
    "",
    "User-agent: BadBot",
    "Disallow: /",
    "",
    "Sitemap: https://example.com/sitemap_index.xml",
  ].join("\n");

  it("applies the * group with longest-match and Allow-wins-ties", () => {
    expect(robotsAllows(txt, "/")).toBe(true);
    expect(robotsAllows(txt, "/private/x")).toBe(false);
    expect(robotsAllows(txt, "/private/ok")).toBe(true);
    expect(robotsAllows(txt, "/private/ok/more")).toBe(false);
    expect(robotsAllows(txt, "/files/menu.pdf")).toBe(false);
    expect(robotsAllows(txt, "/files/menu.pdf?v=2")).toBe(true);
  });

  it("prefers a group naming our agent, case-insensitively", () => {
    const ours = "User-agent: localseoaudit\nDisallow: /\n\nUser-agent: *\nAllow: /";
    expect(robotsAllows(ours, "/")).toBe(false);
    expect(robotsAllows("User-agent: Other\nUser-agent: *\nDisallow: /x", "/x")).toBe(false);
  });

  it("allows everything without a robots.txt", () => {
    expect(robotsAllows(null, "/anything")).toBe(true);
  });

  it("lists sitemaps", () => {
    expect(robotsSitemaps(txt)).toEqual(["https://example.com/sitemap_index.xml"]);
    expect(robotsSitemaps(null)).toEqual([]);
  });
});
