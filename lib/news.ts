import {
  classifyHeadline,
  isFresh,
  placeMentions,
  verdictsFromFlags,
  type Kind,
  type Verdict,
} from "@/lib/classify";
import type { Place } from "@/lib/places";
import { parseRss, type Headline } from "@/lib/rss";

export type HeadlineHit = Headline & { kinds: Kind[] };

export type StatusOk = {
  ok: true;
  place: Place;
  asOf: string;
  phDate: string;
  verdicts: Record<Kind, Verdict>;
  headlines: HeadlineHit[];
};

export type StatusErr = {
  ok: false;
  error: string;
};

export type StatusResult = StatusOk | StatusErr;

function newsUrl(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-PH&gl=PH&ceid=PH:en`;
}

function queryFor(place: Place): string {
  const names = [`"${place.name}"`, ...place.aliases.slice(0, 2).map((a) => `"${a}"`)];
  if (place.ncr) names.push('"Metro Manila"', "NCR");
  return `(${names.join(" OR ")}) ("walang pasok" OR "class suspension" OR "classes suspended" OR "work suspension" OR "government offices" OR suspendido OR "no classes" OR "no work") when:2d`;
}

async function loadRss(query: string): Promise<Headline[]> {
  const res = await fetch(newsUrl(query), {
    headers: {
      "User-Agent": "MayPasokBa/1.0 (personal class-suspension checker)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
    next: { revalidate: 3600, tags: ["news"] },
  });
  if (!res.ok) {
    throw new Error(`news ${res.status}`);
  }
  return parseRss(await res.text());
}

export async function getStatus(place: Place, now = new Date()): Promise<StatusResult> {
  let headlines: Headline[];
  try {
    headlines = await loadRss(queryFor(place));
  } catch {
    return { ok: false, error: "hindi makuha ang news ngayon" };
  }

  const flags: Record<Kind, boolean> = {
    classes: false,
    work: false,
    government: false,
  };
  const hits: HeadlineHit[] = [];

  for (const h of headlines) {
    if (!isFresh(h.publishedAt, now)) continue;
    const blob = `${h.title} ${h.source}`;
    if (!placeMentions(blob, place)) continue;
    const kinds = classifyHeadline(h.title);
    const hitKinds = (Object.keys(kinds) as Kind[]).filter((k) => kinds[k]);
    if (hitKinds.length === 0) continue;
    for (const k of hitKinds) flags[k] = true;
    hits.push({ ...h, kinds: hitKinds });
  }

  const phDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return {
    ok: true,
    place,
    asOf: now.toISOString(),
    phDate,
    verdicts: verdictsFromFlags(flags),
    headlines: hits.slice(0, 8),
  };
}
