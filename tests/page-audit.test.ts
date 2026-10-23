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

  describe("phone match across countries", () => {
    const place = (countryCode: string, nationalPhoneNumber: string, internationalPhoneNumber: string) => ({
      name: "Acme",
      formattedAddress: null,
      nationalPhoneNumber,
      internationalPhoneNumber,
      countryCode,
    });
    const phone = (p: ReturnType<typeof place>, text: string) => napMatch(`Acme ${text}`, p).phone;

    it.each([
      ["IN", "080 4123 4567", "+91 80 4123 4567", "Call +91-80-41234567"],
      ["IN", "080 4123 4567", "+91 80 4123 4567", "Call 080 4123 4567"],
      ["US", "(650) 253-0000", "+1 650-253-0000", "Call 650.253.0000"],
      ["US", "(650) 253-0000", "+1 650-253-0000", "Call 1 (650) 253-0000"],
      ["GB", "020 7946 0958", "+44 20 7946 0958", "Tel: 020 7946 0958"],
      ["GB", "020 7946 0958", "+44 20 7946 0958", "Tel: 0044 20 7946 0958"],
      ["DE", "030 1234567", "+49 30 1234567", "Telefon: 030/1234567"],
      ["DE", "030 1234567", "+49 30 1234567", "Telefon: +49 (0)30 1234567"],
      ["DE", "030 1234567", "+49 30 1234567", "Fax 030 7654321 / 030 1234567"],
    ])("%s %s matches %s", (cc, national, intl, text) => {
      expect(phone(place(cc, national, intl), text)).toBe(1);
    });

    it("does not match a different number or one buried in a longer run", () => {
      const de = place("DE", "030 1234567", "+49 30 1234567");
      expect(phone(de, "Telefon: 030 7654321")).toBe(0);
      expect(phone(de, "Order no. 9988776655 301234567")).toBe(0);
    });

    it("works for old snapshots without country or international number", () => {
      const old = { name: "Acme", formattedAddress: null, nationalPhoneNumber: "080 4123 4567" };
      expect(napMatch("Acme +91 80 4123 4567", old).phone).toBe(1);
    });
  });

  it("ignores the country at the end of Google's address", () => {
    const place = {
      name: "Acme Dental",
      formattedAddress: "221B Baker Street, London NW1 6XE, UK",
      nationalPhoneNumber: null,
      countryCode: "GB",
    };
    expect(napMatch("Acme Dental, 221B Baker Street, London NW1 6XE", place).address).toBe(1);
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
