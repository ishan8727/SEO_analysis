import { parsePhoneNumberFromString } from "libphonenumber-js";

// Phone rules shared by the gate (browser) and /api/verify/confirm (server).
// NEXT_PUBLIC_PHONE_COUNTRIES mirrors the Firebase SMS region policy (allow list); empty = any country.

export function allowedPhoneCountries(raw = process.env.NEXT_PUBLIC_PHONE_COUNTRIES ?? ""): string[] {
  return raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
}

export function isAllowedPhoneCountry(country: string | undefined, allowed: string[]): boolean {
  return allowed.length === 0 || (country !== undefined && allowed.includes(country));
}

/** A valid number in E.164 with its country, or null. Input may be "+44 20 …" or national with `defaultCountry`. */
export function parsePhone(input: string, defaultCountry?: string): { e164: string; country: string | undefined } | null {
  const parsed = parsePhoneNumberFromString(input, defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1]);
  if (!parsed?.isValid()) return null;
  return { e164: parsed.number, country: parsed.country };
}
