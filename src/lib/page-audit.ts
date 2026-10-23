import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import * as cheerio from "cheerio";
import type { DomAuditResult } from "@/types";

// Pure on-page checks. Both renderers end here: Moli hands over the rendered HTML,
// the fallback hands over the raw HTML from safeFetch().

export const AUDIT_USER_AGENT = "LocalSEOAudit";

/* ---------- HTML extraction ---------- */

/** schema.org LocalBusiness and its subtypes (the common ones; schema.org has a few more). */
const LOCAL_BUSINESS_TYPES = new Set(
  `LocalBusiness AnimalShelter ArchiveOrganization AutomotiveBusiness AutoBodyShop AutoDealer AutoPartsStore
  AutoRental AutoRepair AutoWash GasStation MotorcycleDealer MotorcycleRepair ChildCare Dentist DryCleaningOrLaundry
  EmergencyService FireStation Hospital PoliceStation EmploymentAgency EntertainmentBusiness AdultEntertainment
  AmusementPark ArtGallery Casino ComedyClub MovieTheater NightClub FinancialService AccountingService
  AutomatedTeller BankOrCreditUnion InsuranceAgency FoodEstablishment Bakery BarOrPub Brewery CafeOrCoffeeShop
  Distillery FastFoodRestaurant IceCreamShop Restaurant Winery GovernmentOffice PostOffice HealthAndBeautyBusiness
  BeautySalon DaySpa HairSalon HealthClub NailSalon TattooParlor HomeAndConstructionBusiness Electrician
  GeneralContractor HVACBusiness HousePainter Locksmith MovingCompany Plumber RoofingContractor InternetCafe
  LegalService Attorney Notary Library LodgingBusiness BedAndBreakfast Campground Hostel Hotel Motel Resort
  VacationRental MedicalBusiness CommunityHealth Dermatology DietNutrition Emergency Geriatric Gynecologic
  MedicalClinic Midwifery Nursing Obstetric Oncologic Optician Optometric Otolaryngologic Pediatric Pharmacy
  Physician Physiotherapy PlasticSurgery Podiatric PrimaryCare Psychiatric PublicHealth ProfessionalService
  RadioStation RealEstateAgent RecyclingCenter SelfStorage ShoppingCenter SportsActivityLocation BowlingAlley
  ExerciseGym GolfCourse PublicSwimmingPool SkiResort SportsClub StadiumOrArena TennisComplex Store BikeStore
  BookStore ClothingStore ComputerStore ConvenienceStore DepartmentStore ElectronicsStore Florist FurnitureStore
  GardenStore GroceryStore HardwareStore HobbyShop HomeGoodsStore JewelryStore LiquorStore MensClothingStore
  MobilePhoneStore MovieRentalStore MusicStore OfficeEquipmentStore OutletStore PawnShop PetStore ShoeStore
  SportingGoodsStore TireShop ToyStore WholesaleStore TelevisionStation TouristInformationCenter TravelAgency`
    .split(/\s+/)
    .filter(Boolean),
);

const ORDERING_RE =
  /\b(order (online|now|here)|buy now|add to (cart|bag)|shop now|place (an |your )?order|home delivery|online delivery|cart|checkout)\b/i;
const BOOKING_RE =
  /\b(book (now|online|a table|an? appointment|a consultation)|make an appointment|schedule (an? )?(appointment|visit|consultation)|reserve (a table|now)|reservations?|appointments?)\b/i;
// Third-party ordering/booking sites, international. Subdomains match too.
const ORDERING_HOSTS = [
  "swiggy.com", "zomato.com", "magicpin.in", "dunzo.com", // IN
  "ubereats.com", "doordash.com", "grubhub.com", "postmates.com", "seamless.com", "toasttab.com", // US
  "deliveroo.com", "deliveroo.co.uk", "just-eat.co.uk", "just-eat.com", "lieferando.de", "thuisbezorgd.nl", "wolt.com", "glovoapp.com", // EU/UK
  "talabat.com", "noon.com", "careem.com", "foodpanda.com", "grab.com", "menulog.com.au", "skipthedishes.com", // ME/APAC/CA
  "order.online", "square.site", "shopify.com", "orderyoyo.com",
];
const BOOKING_HOSTS = [
  "practo.com", "lybrate.com", "dineout.co.in", // IN
  "calendly.com", "booksy.com", "fresha.com", "treatwell.com", "treatwell.co.uk", "vagaro.com", "mindbodyonline.com",
  "setmore.com", "acuityscheduling.com", "squareup.com", "simplybook.me", "schedulicity.com", "styleseat.com",
  "opentable.com", "opentable.co.uk", "resy.com", "sevenrooms.com", "thefork.com", "quandoo.com", "tock.com",
  "zocdoc.com", "doctolib.fr", "doctolib.de", "healthengine.com.au", "hotdoc.com.au", "jameda.de",
];

export type PageFacts = Omit<DomAuditResult, "renderer" | "finalUrl" | "httpStatus" | "robotsTxt" | "sitemapXml" | "napMatch">;

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
const hostIs = (host: string, domains: string[]) => {
  const h = bareHost(host);
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
};

function isWhatsAppUrl(u: URL): boolean {
  return u.protocol === "whatsapp:" || hostIs(u.hostname, ["wa.me", "api.whatsapp.com", "web.whatsapp.com", "chat.whatsapp.com"]);
}

function isMapsUrl(u: URL): boolean {
  const h = bareHost(u.hostname);
  if (h === "maps.app.goo.gl" || h === "g.page" || h.startsWith("maps.google.")) return true;
  if ((h === "goo.gl" || /^google\.[a-z.]+$/.test(h)) && u.pathname.startsWith("/maps")) return true;
  return false;
}

function schemaTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((n) => schemaTypes(n, out));
  if (!node || typeof node !== "object") return;
  const t = (node as Record<string, unknown>)["@type"];
  for (const type of Array.isArray(t) ? t : [t]) {
    if (typeof type === "string") out.add(type.replace(/^(https?:\/\/)?schema\.org\//i, "").replace(/^schema:/i, ""));
  }
  for (const value of Object.values(node)) schemaTypes(value, out);
}

function absolute(href: string | undefined, base: URL): string | null {
  if (!href?.trim()) return null;
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return null;
  }
}

/** Extracts the on-page facts plus the visible text (used for NAP matching, never stored). */
export function extractPage(html: string, pageUrl: string): { facts: PageFacts; text: string } {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const meta = (name: string) => $(`meta[name="${name}" i]`).first().attr("content")?.trim() || null;

  const types = new Set<string>();
  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      schemaTypes(JSON.parse($(el).text()), types);
    } catch {
      // Broken JSON-LD is common; Google ignores it too.
    }
  });
  const jsonLdTypes = [...types].slice(0, 30);

  const ogTags: Record<string, string> = {};
  $('meta[property^="og:" i]').each((_, el) => {
    const key = $(el).attr("property")?.toLowerCase();
    const value = $(el).attr("content")?.trim();
    if (key && value && Object.keys(ogTags).length < 20) ogTags[key] ??= value.slice(0, 300);
  });

  const imgs = $("img");
  const missingAlt = imgs.filter((_, el) => !$(el).attr("alt")?.trim()).length;

  const links = { internal: 0, external: 0, tel: 0, whatsapp: 0, maps: 0 };
  const telHrefs: string[] = [];
  let orderingLink = false;
  let bookingLink = false;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!.trim();
    if (/^tel:/i.test(href)) {
      links.tel++;
      telHrefs.push(href.slice(4));
      return;
    }
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (isWhatsAppUrl(u)) links.whatsapp++;
    else if (u.protocol !== "http:" && u.protocol !== "https:") return; // mailto:, javascript:, ...
    else if (isMapsUrl(u)) links.maps++;
    else if (bareHost(u.hostname) === bareHost(base.hostname)) links.internal++;
    else {
      links.external++;
      orderingLink ||= hostIs(u.hostname, ORDERING_HOSTS);
      bookingLink ||= hostIs(u.hostname, BOOKING_HOSTS);
    }
  });
  $("iframe[src]").each((_, el) => {
    const src = absolute($(el).attr("src"), base);
    if (src && isMapsUrl(new URL(src))) links.maps++;
  });

  $("script, style, noscript, template, svg").remove();
  const text = `${$("body").text()} ${telHrefs.join(" ")}`.replace(/\s+/g, " ").trim().slice(0, 200_000);

  const viewport = meta("viewport");
  return {
    facts: {
      title: $("title").first().text().trim() || null,
      metaDescription: meta("description"),
      canonical: absolute($('link[rel~="canonical" i]').first().attr("href"), base),
      robotsMeta: meta("robots"),
      viewport: Boolean(viewport && /width\s*=/i.test(viewport)),
      h1Count: $("h1").length,
      h2Count: $("h2").length,
      jsonLdTypes,
      hasLocalSchema: jsonLdTypes.some((t) => LOCAL_BUSINESS_TYPES.has(t)),
      ogTags,
      images: { total: imgs.length, missingAlt },
      links,
      keywordHits: { ordering: orderingLink || ORDERING_RE.test(text), booking: bookingLink || BOOKING_RE.test(text) },
    },
    text,
  };
}

/* ---------- NAP match (local mode) ---------- */

// Legal-form suffixes and filler words that differ between a Google listing and a website.
const NAP_STOPWORDS = new Set(
  `the and of co pvt ltd private limited llp inc llc corp corporation plc pty gmbh ag kg ug sarl sas sa bv nv srl spa
  ab oy as aps kft sro sp zoo`.split(/\s+/),
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !NAP_STOPWORDS.has(t));
}

/** Share of the reference's distinct tokens that appear on the page; null without a reference. */
function tokenOverlap(reference: string | null, page: Set<string>): number | null {
  const ref = new Set(tokens(reference ?? ""));
  if (ref.size === 0) return null;
  let found = 0;
  for (const t of ref) if (page.has(t)) found++;
  return Math.round((found / ref.size) * 100) / 100;
}

/**
 * The national significant number of Google's phone ("+49 30 1234567" → "301234567"), without the country
 * code or trunk prefix. Falls back to the digits without leading zeros when the number can't be parsed.
 */
function nationalDigits(place: NapPlace): string | null {
  const country = (place.countryCode ?? undefined) as CountryCode | undefined;
  for (const raw of [place.internationalPhoneNumber, place.nationalPhoneNumber]) {
    if (!raw) continue;
    const parsed = parsePhoneNumberFromString(raw, country);
    if (parsed) return parsed.nationalNumber;
  }
  const digits = (place.nationalPhoneNumber ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

/**
 * 1 if the page shows the same number; null without a reference. A page number matches when its digits end
 * with the national number and what comes before is at most a country code / trunk prefix
 * ("+49 (0)30 …", "0049 30 …", "030 …" all match "301234567").
 */
function phoneMatch(place: NapPlace, pageText: string): number | null {
  const ref = nationalDigits(place);
  if (!ref || ref.length < 6) return null;
  // "/" joins German-style numbers ("030/1234567"); " / " separates two numbers.
  const candidates = (pageText.match(/\+?\d[\d\s().\/-]{5,}\d/g) ?? []).flatMap((c) => c.split(" / "));
  return candidates.some((c) => {
    const digits = c.replace(/\D/g, "");
    return digits.endsWith(ref) && digits.length - ref.length <= 5;
  })
    ? 1
    : 0;
}

/** Google ends formattedAddress with the country ("…, 560038, India"); sites rarely repeat it. */
function withoutCountry(place: NapPlace): string | null {
  if (!place.formattedAddress || !place.countryCode) return place.formattedAddress;
  const parts = place.formattedAddress.split(",");
  return parts.length > 1 ? parts.slice(0, -1).join(",") : place.formattedAddress;
}

/** The Google profile fields NAP compares against (a PlaceSnapshot fits). */
export interface NapPlace {
  name: string;
  formattedAddress: string | null;
  nationalPhoneNumber: string | null;
  internationalPhoneNumber?: string | null;
  countryCode?: string | null;
}

/**
 * Name/address/phone consistency between the website and the Google profile.
 * A part with nothing to compare against (e.g. no phone on Google) reads 0 and is left out of `score`.
 */
export function napMatch(
  pageText: string,
  place: NapPlace,
): NonNullable<DomAuditResult["napMatch"]> {
  const page = new Set(tokens(pageText));
  const parts = {
    name: tokenOverlap(place.name, page),
    address: tokenOverlap(withoutCountry(place), page),
    phone: phoneMatch(place, pageText),
  };
  const known = Object.values(parts).filter((v): v is number => v !== null);
  const score = known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 100) / 100 : 0;
  return { name: parts.name ?? 0, address: parts.address ?? 0, phone: parts.phone ?? 0, score };
}

/* ---------- robots.txt ---------- */

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

function parseRobots(txt: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap" && value) sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/**
 * RFC 9309: use the groups naming our agent, else the `*` groups; the longest matching rule
 * wins and Allow wins a tie. No robots.txt means everything is allowed.
 */
export function robotsAllows(robotsTxt: string | null, path: string, agent = AUDIT_USER_AGENT): boolean {
  if (!robotsTxt) return true;
  const { groups } = parseRobots(robotsTxt);
  const ours = groups.filter((g) => g.agents.includes(agent.toLowerCase()));
  const rules = (ours.length ? ours : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: { allow: boolean; pattern: string } | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

export function robotsSitemaps(robotsTxt: string | null): string[] {
  return robotsTxt ? parseRobots(robotsTxt).sitemaps : [];
}
