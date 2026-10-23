import { describe, expect, it } from "vitest";
import { parseSentiment, reviewsForModel } from "@/lib/gemini";

describe("reviewsForModel", () => {
  it("keeps rating + text only, drops empty reviews and truncates long ones", () => {
    const out = reviewsForModel([
      { rating: 5, text: "  Great staff  ", publishTime: "2026-10-01T00:00:00Z" },
      { rating: 1, text: null, publishTime: "2026-10-01T00:00:00Z" },
      { rating: 2, text: "   ", publishTime: "2026-10-01T00:00:00Z" },
      { rating: 3, text: "x".repeat(5000), publishTime: "2026-10-01T00:00:00Z" },
    ]);
    expect(out).toEqual([
      { rating: 5, text: "Great staff" },
      { rating: 3, text: "x".repeat(1000) },
    ]);
  });
});

describe("parseSentiment", () => {
  it("parses, clamps and trims the model output", () => {
    const json = JSON.stringify({
      loves: ["Kind staff", "Painless treatment", "a", "b", "c", "d"],
      complaints: [],
      positiveRatio: 1.4,
      summary: " Customers love the kind staff. ",
    });
    expect(parseSentiment(json, 4)).toEqual({
      loves: ["Kind staff", "Painless treatment", "a", "b", "c"],
      complaints: [],
      positiveRatio: 1,
      summary: "Customers love the kind staff.",
      reviewCount: 4,
    });
  });

  it("rejects bad output without echoing it", () => {
    expect(() => parseSentiment("not json: private review text", 1)).toThrow("Gemini returned non-JSON output");
    expect(() => parseSentiment('{"loves":"private review text"}', 1)).toThrow(
      "Gemini returned an invalid sentiment payload",
    );
    expect(() => parseSentiment(undefined, 1)).toThrow();
  });
});
