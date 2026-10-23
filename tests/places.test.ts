import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlaceDetails, PLACE_DETAILS_FIELDS, PlacesError, toPlaceSnapshot } from "@/lib/google/places";
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
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4?languageCode=en&regionCode=IN");
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
