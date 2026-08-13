import { matchGeo } from "@/lib/places";

type Nominatim = {
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state?: string;
  };
};

function isNominatim(value: unknown): value is Nominatim {
  if (typeof value !== "object" || value === null) return false;
  const address = (value as { address?: unknown }).address;
  return address === undefined || typeof address === "object";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (!lat || !lon) {
    return Response.json({ ok: false, error: "need lat and lon" }, { status: 400 });
  }

  const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=jsonv2&zoom=14`;
  const res = await fetch(geoUrl, {
    headers: {
      "User-Agent": "MayPasokBa/1.0 (personal class-suspension checker)",
      Accept: "application/json",
    },
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    return Response.json({ ok: false, error: "hindi makuha ang location" }, { status: 502 });
  }

  const body: unknown = await res.json();
  if (!isNominatim(body) || !body.address) {
    return Response.json({ ok: false, error: "walang address" }, { status: 404 });
  }

  const place = matchGeo(body.address);
  if (!place) {
    return Response.json({ ok: false, error: "hindi makita ang lungsod" }, { status: 404 });
  }

  return Response.json({ ok: true, place });
}
