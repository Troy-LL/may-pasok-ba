import places0 from "../data/places.json" with { type: "json" };
import places1 from "../data/places-1.json" with { type: "json" };
import places2 from "../data/places-2.json" with { type: "json" };

export type PlaceKind = "city" | "municipality" | "region";
export type Island = "luzon" | "visayas" | "mindanao";

export type Place = {
  id: string;
  name: string;
  province: string;
  island: Island;
  ncr: boolean;
  kind: PlaceKind;
  aliases: string[];
};

/** Not an LGU — NCR-wide announcements. Keep out of the JSON shards. */
const METRO_MANILA: Place = {
  id: "metro-manila",
  name: "Metro Manila",
  province: "NCR",
  island: "luzon",
  ncr: true,
  kind: "region",
  aliases: ["NCR", "National Capital Region", "Kalakhang Maynila"],
};

const LGUS = [...places0, ...places1, ...places2] as Place[];
const PLACES: Place[] = [METRO_MANILA, ...LGUS];
const NCR_PLACES = PLACES.filter((p) => p.ncr);

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

export const DEFAULT_PLACE_ID = "quezon-city";

const PINNED_IDS = [
  "metro-manila",
  "quezon-city",
  "manila",
  "caloocan",
  "taguig",
  "pasig",
  "makati",
  "mandaluyong",
  "marikina",
  "pasay",
  "paranaque",
  "las-pinas",
  "muntinlupa",
  "valenzuela",
  "malabon",
  "navotas",
  "san-juan",
  "pateros",
];

export const WARM_PLACE_IDS = NCR_PLACES.map((p) => p.id);

export function allPlaces(): Place[] {
  return NCR_PLACES;
}

export function getPlace(id: string): Place | undefined {
  const place = BY_ID.get(id);
  return place?.ncr ? place : undefined;
}

export function labelOf(place: Place): string {
  return `${place.name}, ${place.province}`;
}

export function pickerPlaces(): Place[] {
  const pinned = PINNED_IDS.map((id) => BY_ID.get(id)).filter(
    (p): p is Place => p !== undefined && p.ncr,
  );
  const rest = NCR_PLACES.filter((p) => !PINNED_IDS.includes(p.id));
  return [...pinned, ...rest];
}

export function filterPlaces(query: string, limit = 20): Place[] {
  const all = pickerPlaces();
  const q = slug(query);
  if (!q) return all;
  return all
    .filter((p) => {
      if (slug(labelOf(p)).includes(q) || slug(p.name).includes(q)) return true;
      if (slug(p.province).includes(q)) return true;
      return p.aliases.some((a) => slug(a).includes(q));
    })
    .slice(0, limit);
}

function slug(s: string): string {
  return s
    .replace(/ñ/gi, "n")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function resolvePlace(input: string): Place {
  const fallback = BY_ID.get("metro-manila") ?? METRO_MANILA;
  const trimmed = input.trim();
  if (!trimmed) {
    return BY_ID.get(DEFAULT_PLACE_ID) ?? fallback;
  }
  const byId = getPlace(trimmed) ?? getPlace(slug(trimmed));
  if (byId) return byId;

  const q = slug(trimmed);
  const labeled = NCR_PLACES.find((p) => slug(labelOf(p)) === q);
  if (labeled) return labeled;

  const nameHit = NCR_PLACES.find(
    (p) =>
      slug(p.name) === q ||
      p.aliases.some((a) => slug(a) === q) ||
      slug(labelOf(p)).startsWith(q),
  );
  if (nameHit) return nameHit;

  const contains = NCR_PLACES.find(
    (p) => slug(p.name).includes(q) || q.includes(slug(p.name)),
  );
  if (contains) return contains;

  return fallback;
}

export function matchGeo(parts: {
  city?: string;
  town?: string;
  municipality?: string;
  village?: string;
  suburb?: string;
  county?: string;
  state?: string;
}): Place | undefined {
  const locality =
    parts.city || parts.town || parts.municipality || parts.village || "";
  const province = parts.state || parts.county || "";
  if (!locality) return undefined;

  const loc = slug(locality);
  const prov = slug(province);

  const inProvince = NCR_PLACES.filter((p) => {
    if (slug(p.name) !== loc && !p.aliases.some((a) => slug(a) === loc)) {
      return false;
    }
    if (!prov) return true;
    return slug(p.province) === prov || p.ncr;
  });
  if (inProvince.length === 1) return inProvince[0];
  if (inProvince.length > 1) {
    return (
      inProvince.find((p) => slug(p.province) === prov) ?? inProvince[0]
    );
  }
  return undefined;
}
