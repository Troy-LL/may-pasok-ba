import places0 from "@/data/places.json";
import places1 from "@/data/places-1.json";
import places2 from "@/data/places-2.json";

export type PlaceKind = "city" | "municipality";
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

const PLACES: Place[] = [...places0, ...places1, ...places2];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

export const DEFAULT_PLACE_ID = "quezon-city";

const PINNED_IDS = [
  "quezon-city",
  "manila",
  "cebu",
  "davao",
  "caloocan",
  "taguig",
  "pasig",
  "makati",
  "cagayan-de-oro",
  "zamboanga",
  "antipolo",
  "dasmarinas",
  "bacoor",
  "iloilo",
  "bacolod",
  "cainta",
  "baguio",
  "general-santos",
  "valenzuela",
  "paranaque",
];

export const WARM_PLACE_IDS = PINNED_IDS;

export function allPlaces(): Place[] {
  return PLACES;
}

export function getPlace(id: string): Place | undefined {
  return BY_ID.get(id);
}

export function labelOf(place: Place): string {
  return `${place.name}, ${place.province}`;
}

export function pickerPlaces(): Place[] {
  const pinned = PINNED_IDS.map((id) => BY_ID.get(id)).filter(
    (p): p is Place => p !== undefined,
  );
  const rest = PLACES.filter((p) => !PINNED_IDS.includes(p.id));
  return [...pinned, ...rest];
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
  const trimmed = input.trim();
  if (!trimmed) {
    return BY_ID.get(DEFAULT_PLACE_ID) ?? PLACES[0];
  }
  const byId = BY_ID.get(trimmed) ?? BY_ID.get(slug(trimmed));
  if (byId) return byId;

  const q = slug(trimmed);
  const labeled = PLACES.find((p) => slug(labelOf(p)) === q);
  if (labeled) return labeled;

  const nameHit = PLACES.find(
    (p) =>
      slug(p.name) === q ||
      p.aliases.some((a) => slug(a) === q) ||
      slug(labelOf(p)).startsWith(q),
  );
  if (nameHit) return nameHit;

  const contains = PLACES.find(
    (p) => slug(p.name).includes(q) || q.includes(slug(p.name)),
  );
  if (contains) return contains;

  return {
    id: q || DEFAULT_PLACE_ID,
    name: trimmed,
    province: "Philippines",
    island: "luzon",
    ncr: false,
    kind: "municipality",
    aliases: [],
  };
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

  const inProvince = PLACES.filter((p) => {
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
  return resolvePlace(locality);
}
