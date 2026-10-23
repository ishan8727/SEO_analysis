// Security headers for every response (SPEC.md section 10), applied from next.config.ts.
//
// Allowlist CSP without nonces: nonces need every page rendered per request, which doesn't work with
// Cache Components / Partial Prerendering (Next 16 CSP guide). So inline scripts stay allowed
// ('unsafe-inline', Next's bootstrap and RSC payload) and the protection comes from limiting *where*
// scripts, frames and requests may go. Each third-party host is listed with the feature that needs it.
// Headers are computed when the config loads (build, or `next dev`), so `isDev` is a build-time value.

export interface SecurityHeaderOptions {
  isDev: boolean;
  firebaseAuthDomain?: string; // NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, e.g. tsi-project-cd47e.firebaseapp.com
}

const MAPS = ["https://maps.googleapis.com", "https://maps.gstatic.com"]; // Places Autocomplete (Maps JS SDK)
const PLACES_RPC = "https://places.googleapis.com"; // Places (New) calls made by the Maps JS SDK
const TURNSTILE = "https://challenges.cloudflare.com"; // Cloudflare Turnstile on the search form
const RECAPTCHA_SCRIPTS = ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"]; // phone gate
const RECAPTCHA_FRAMES = ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"];
const FIREBASE_AUTH_API = ["https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"];
const OSM_TILES = "https://tile.openstreetmap.org"; // Leaflet map on the report

export function contentSecurityPolicy({ isDev, firebaseAuthDomain }: SecurityHeaderOptions): string {
  const authFrame = firebaseAuthDomain ? [`https://${firebaseAuthDomain}`] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in dev: React uses eval there for error stacks.
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...MAPS, TURNSTILE, ...RECAPTCHA_SCRIPTS],
    "style-src": ["'self'", "'unsafe-inline'"], // next/font, Leaflet and the widgets set inline styles
    "img-src": ["'self'", "data:", "blob:", ...MAPS, OSM_TILES, "https://www.gstatic.com"],
    "font-src": ["'self'"], // next/font serves Geist from our own origin
    "connect-src": ["'self'", ...MAPS, PLACES_RPC, ...FIREBASE_AUTH_API, TURNSTILE, ...(isDev ? ["ws:"] : [])],
    "frame-src": [TURNSTILE, ...RECAPTCHA_FRAMES, ...authFrame],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    // Browsers ignore HSTS on plain http, so a production build tested on http://localhost is unaffected.
    ...(options.isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  ];
}
