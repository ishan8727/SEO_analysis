import { z } from "zod";
import { env } from "@/lib/env";
import type { CompetitorsResult, GbpResult, PlaceSnapshot } from "@/types";

// Places API (New), server key only. Billing note: the field masks below include
// Enterprise (+ Atmosphere for Details) fields (see SPEC.md section 1).

const PLACES_BASE = "https://places.googleapis.com/v1";

export const PLACE_DETAILS_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "websiteUri",
  "nationalPhoneNumber",
  "rating",
  "userRatingCount",
  "reviews",
  "regularOpeningHours",
  "photos",
  "businessStatus",
  "primaryType",
  "editorialSummary",
  "googleMapsUri",
].join(",");

export class PlacesError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

const localizedText = z.object({ text: z.string() });

// Only the fields we keep; unknown fields are stripped.
const placeDetailsSchema = z.object({
  id: z.string(),
  displayName: localizedText.optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  websiteUri: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  reviews: z
    .array(
      z.object({
        rating: z.number().optional(),
        text: localizedText.optional(),
        originalText: localizedText.optional(),
        publishTime: z.string().optional(),
      }),
    )
    .optional(),
  regularOpeningHours: z.object({ weekdayDescriptions: z.array(z.string()).optional() }).optional(),
  photos: z.array(z.unknown()).optional(),
  businessStatus: z.string().optional(),
  primaryType: z.string().optional(),
  editorialSummary: localizedText.optional(),
  googleMapsUri: z.string().optional(),
});

export type PlaceDetailsResponse = z.input<typeof placeDetailsSchema>;

/** Maps a Place Details response to the trimmed snapshot we store (no photo data, no reviewer identity). */
export function toPlaceSnapshot(raw: unknown, now = new Date()): PlaceSnapshot {
  const p = placeDetailsSchema.parse(raw);
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "Unnamed business",
    formattedAddress: p.formattedAddress ?? null,
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    websiteUri: p.websiteUri ?? null,
    nationalPhoneNumber: p.nationalPhoneNumber ?? null,
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? 0,
    reviews: (p.reviews ?? [])
      .filter((r) => r.rating !== undefined && r.publishTime)
      .map((r) => ({
        rating: r.rating!,
        text: r.originalText?.text ?? r.text?.text ?? null,
        publishTime: r.publishTime!,
      })),
    weekdayHours: p.regularOpeningHours?.weekdayDescriptions ?? null,
    photosCount: p.photos?.length ?? 0,
    businessStatus: p.businessStatus ?? null,
    primaryType: p.primaryType ?? null,
    editorialSummary: p.editorialSummary?.text ?? null,
    googleMapsUri: p.googleMapsUri ?? null,
    fetchedAt: now.toISOString(),
  };
}

/** Calls Places (New) with the server key and a field mask. Error messages never include the key or the body. */
async function placesFetch(url: string, fieldMask: string, body?: unknown): Promise<unknown> {
  const { GOOGLE_SERVER_KEY } = env();
  if (!GOOGLE_SERVER_KEY) throw new PlacesError(500, "GOOGLE_SERVER_KEY is not set");

  const headers: Record<string, string> = { "X-Goog-Api-Key": GOOGLE_SERVER_KEY, "X-Goog-FieldMask": fieldMask };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Body may echo request details; keep only status + Google's error status.
    const err = (await res.json().catch(() => null)) as { error?: { status?: string } } | null;
    throw new PlacesError(res.status, `Places request failed: ${res.status} ${err?.error?.status ?? ""}`.trim());
  }
  return res.json();
}

export async function getPlaceDetails(placeId: string): Promise<PlaceSnapshot> {
  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}?languageCode=en&regionCode=${env().DEFAULT_COUNTRY}`;
  return toPlaceSnapshot(await placesFetch(url, PLACE_DETAILS_FIELDS));
}

/* ---------- GBP checklist (Phase 3) ---------- */

/** Scan.gbp from the stored snapshot. Checklist keys mirror config/scoring.json → gbp. */
export function toGbpResult(s: PlaceSnapshot): GbpResult {
  const newest = s.reviews.reduce<string | null>(
    (best, r) => (best === null || Date.parse(r.publishTime) > Date.parse(best) ? r.publishTime : best),
    null,
  );
  return {
    checks: {
      hasWebsite: Boolean(s.websiteUri),
      hasPhone: Boolean(s.nationalPhoneNumber),
      hasHours: (s.weekdayHours?.length ?? 0) > 0,
      hasDescription: Boolean(s.editorialSummary),
      photosCount: s.photosCount,
      isOperational: s.businessStatus === "OPERATIONAL",
      hasPrimaryType: Boolean(s.primaryType),
    },
    rating: s.rating,
    reviewCount: s.userRatingCount,
    newestReviewAt: newest,
  };
}

/* ---------- Nearby Search (Phase 3) ---------- */

export const NEARBY_RADIUS_M = 3000;
export const NEARBY_FIELDS = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.websiteUri",
].join(",");

const nearbySchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: localizedText.optional(),
        rating: z.number().optional(),
        userRatingCount: z.number().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
        websiteUri: z.string().optional(),
      }),
    )
    .optional(), // Google omits `places` when nothing matches
});

/** Great-circle distance in whole metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Maps a Nearby Search response to Scan.competitors, dropping the scanned business itself. */
export function toCompetitorsResult(
  raw: unknown,
  self: { placeId: string; location: { lat: number; lng: number }; primaryType: string },
): CompetitorsResult {
  const places = nearbySchema.parse(raw).places ?? [];
  return {
    radiusM: NEARBY_RADIUS_M,
    primaryType: self.primaryType,
    items: places
      .filter((p) => p.id !== self.placeId)
      .map((p) => {
        const location = p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null;
        return {
          placeId: p.id,
          name: p.displayName?.text ?? "Unnamed business",
          rating: p.rating ?? null,
          reviewCount: p.userRatingCount ?? 0,
          location,
          websiteUri: p.websiteUri ?? null,
          distanceM: location ? distanceM(self.location, location) : null,
        };
      }),
  };
}

/** Up to 10 popular places of the same primary type within NEARBY_RADIUS_M (self excluded). */
export async function searchNearby(self: {
  placeId: string;
  location: { lat: number; lng: number };
  primaryType: string;
}): Promise<CompetitorsResult> {
  const raw = await placesFetch(`${PLACES_BASE}/places:searchNearby`, NEARBY_FIELDS, {
    includedPrimaryTypes: [self.primaryType],
    maxResultCount: 10,
    rankPreference: "POPULARITY",
    locationRestriction: {
      circle: { center: { latitude: self.location.lat, longitude: self.location.lng }, radius: NEARBY_RADIUS_M },
    },
    languageCode: "en",
    regionCode: env().DEFAULT_COUNTRY,
  });
  return toCompetitorsResult(raw, self);
}
