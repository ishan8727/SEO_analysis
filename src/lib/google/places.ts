import { z } from "zod";
import { env } from "@/lib/env";
import type { PlaceSnapshot } from "@/types";

// Places API (New), server key only. Billing note: the field mask below includes
// Enterprise + Atmosphere fields (see SPEC.md section 1).

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

export async function getPlaceDetails(placeId: string): Promise<PlaceSnapshot> {
  const { GOOGLE_SERVER_KEY, DEFAULT_COUNTRY } = env();
  if (!GOOGLE_SERVER_KEY) throw new PlacesError(500, "GOOGLE_SERVER_KEY is not set");

  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}?languageCode=en&regionCode=${DEFAULT_COUNTRY}`;
  const res = await fetch(url, {
    headers: { "X-Goog-Api-Key": GOOGLE_SERVER_KEY, "X-Goog-FieldMask": PLACE_DETAILS_FIELDS },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Body may echo request details; keep only status + Google's error status.
    const body = (await res.json().catch(() => null)) as { error?: { status?: string } } | null;
    throw new PlacesError(res.status, `Place Details failed: ${res.status} ${body?.error?.status ?? ""}`.trim());
  }
  return toPlaceSnapshot(await res.json());
}
