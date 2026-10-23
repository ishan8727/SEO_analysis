import { afterEach, describe, expect, it, vi } from "vitest";
import {
  distanceM,
  getPlaceDetails,
  NEARBY_FIELDS,
  NEARBY_RADIUS_M,
  PLACE_DETAILS_FIELDS,
  PlacesError,
  searchNearby,
  toCompetitorsResult,
  toGbpResult,
  toPlaceSnapshot,
} from "@/lib/google/places";
import nearbyFixture from "./fixtures/nearby.json";
import fixture from "./fixtures/place-details.json";

afterEach(() => vi.unstubAllGlobals());

describe("toPlaceSnapshot", () => {
  const snap = toPlaceSnapshot(fixture, new Date("2026-10-23T00:00:00Z"));

  it("maps the fields we keep", () => {
    expect(snap).toMatchObject({
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      name: "Sharma Dental Care",
      location: { lat: 12.9719, lng: 77.6412 },
      websiteUri: "https://sharmadental.example.in/",
      nationalPhoneNumber: "080 4123 4567",
      internationalPhoneNumber: "+91 80 4123 4567",
      countryCode: "IN",
      rating: 4.6,
      userRatingCount: 212,
      weekdayHours: ["Monday: 10:00 AM – 8:00 PM", "Tuesday: 10:00 AM – 8:00 PM"],
      photosCount: 3,
      businessStatus: "OPERATIONAL",
      primaryType: "dentist",
      editorialSummary: "Family dental clinic.",
      fetchedAt: "2026-10-23T00:00:00.000Z",
    });
  });

  it("keeps rating, text and date per review, drops reviewer identity and incomplete reviews", () => {
    expect(snap.reviews).toEqual([
      { rating: 5, text: "Painless root canal, very kind staff.", publishTime: "2026-10-05T09:12:00Z" },
      { rating: 3, text: "Long wait on Saturday.", publishTime: "2026-07-01T10:00:00Z" },
    ]);
    expect(JSON.stringify(snap)).not.toContain("A Reviewer");
  });

  it("fills safe defaults for a sparse place", () => {
    expect(toPlaceSnapshot({ id: "abc" })).toMatchObject({
      name: "Unnamed business",
      location: null,
      websiteUri: null,
      userRatingCount: 0,
      reviews: [],
      weekdayHours: null,
      photosCount: 0,
    });
  });
});

describe("getPlaceDetails", () => {
  it("calls Places (New) with the server key and field mask", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture));
    vi.stubGlobal("fetch", fetchMock);

    const snap = await getPlaceDetails("ChIJN1t_tDeuEmsRUsoyG83frY4");

    expect(snap.name).toBe("Sharma Dental Care");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4?languageCode=en");
    expect(init.headers).toEqual({ "X-Goog-Api-Key": "test-server-key", "X-Goog-FieldMask": PLACE_DETAILS_FIELDS });
  });

  it("throws PlacesError with Google's status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })),
    );
    await expect(getPlaceDetails("ChIJmissing00")).rejects.toMatchObject({ name: "PlacesError", status: 404 });
    expect(PlacesError).toBeDefined();
  });
});

describe("toGbpResult", () => {
  it("builds the checklist from the snapshot", () => {
    expect(toGbpResult(toPlaceSnapshot(fixture))).toEqual({
      checks: {
        hasWebsite: true,
        hasPhone: true,
        hasHours: true,
        hasDescription: true,
        photosCount: 3,
        isOperational: true,
        hasPrimaryType: true,
      },
      rating: 4.6,
      reviewCount: 212,
      newestReviewAt: "2026-10-05T09:12:00Z",
    });
  });

  it("fails every check for an empty profile", () => {
    const gbp = toGbpResult(toPlaceSnapshot({ id: "abc" }));
    expect(Object.values(gbp.checks).filter(Boolean)).toEqual([]);
    expect(gbp).toMatchObject({ rating: null, reviewCount: 0, newestReviewAt: null });
  });
});

describe("nearby search", () => {
  const self = {
    placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    location: { lat: 12.9719, lng: 77.6412 },
    primaryType: "dentist",
  };

  it("drops the business itself and computes distances", () => {
    const result = toCompetitorsResult(nearbyFixture, self);
    expect(result.radiusM).toBe(NEARBY_RADIUS_M);
    expect(result.items.map((c) => c.placeId)).toEqual(["ChIJcompetitor000001", "ChIJcompetitor000002"]);
    expect(result.items[0]).toMatchObject({ name: "Smile Studio Indiranagar", rating: 4.8, reviewCount: 640 });
    expect(result.items[0].distanceM).toBeGreaterThan(700);
    expect(result.items[0].distanceM).toBeLessThan(740);
    expect(result.items[1]).toMatchObject({ rating: null, reviewCount: 0, websiteUri: null });
  });

  it("handles an empty response", () => {
    expect(toCompetitorsResult({}, self).items).toEqual([]);
  });

  it("distanceM is symmetric and zero for the same point", () => {
    const a = { lat: 12.97, lng: 77.64 };
    const b = { lat: 13.0, lng: 77.6 };
    expect(distanceM(a, a)).toBe(0);
    expect(distanceM(a, b)).toBe(distanceM(b, a));
  });

  it("POSTs searchNearby with the type, a 3 km circle and the field mask", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(nearbyFixture));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNearby(self);

    expect(result.items).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-Goog-FieldMask": NEARBY_FIELDS, "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      includedPrimaryTypes: ["dentist"],
      maxResultCount: 10,
      rankPreference: "POPULARITY",
      locationRestriction: { circle: { center: { latitude: 12.9719, longitude: 77.6412 }, radius: 3000 } },
      languageCode: "en",
    });
  });
});
