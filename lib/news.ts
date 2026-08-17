import {
  classifyHeadline,
  isFresh,
  placeMentions,
  verdictsFromFlags,
  type Kind,
  type Verdict,
} from "./classify.ts";
import {
  bodyEvidenceForPlace,
  enrichArticleBodies,
  type ArticleResolver,
} from "./articles.ts";
import type { Place } from "./places.ts";
import { parseRss, type Headline } from "./rss.ts";

export type { Headline, ArticleResolver };
export type Confidence = "none" | "reported" | "confirmed";
export type HeadlineHit = Omit<Headline, "body"> & { kinds: Kind[] };
export type RssFallback = (url: string) => Promise<string>;

export type StatusOk = {
  ok: true;
  place: Place;
  asOf: string;
  phDate: string;
  verdicts: Record<Kind, Verdict>;
  confidence: Record<Kind, Confidence>;
  headlines: HeadlineHit[];
  days: WeekDay[];
};

export type StatusErr = {
  ok: false;
  error: string;
};

export type StatusResult = StatusOk | StatusErr;

export type WeekDay = Pick<
  StatusOk,
  "verdicts" | "confidence" | "headlines"
> & {
  date: string;
};

export type WeeklyResult =
  | {
      ok: true;
      place: Place;
      asOf: string;
      days: WeekDay[];
    }
  | StatusErr;

const ALLOWLIST = [
  "gma",
  "inquirer",
  "rappler",
  "philstar",
  "philippine star",
  "sunstar",
  "sun star",
  "abs-cbn",
  "manila bulletin",
  "cnn philippines",
  "rptv",
  "manila times",
  "tv5",
  "news5",
  "dzbb",
  "dzmm",
];

function isAllowlisted(source: string): boolean {
  const s = source.toLowerCase();
  return ALLOWLIST.some((name) => s.includes(name));
}

function newsUrl(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-PH&gl=PH&ceid=PH:en`;
}

export const NEWS_QUERIES = [
  '("walang pasok" OR "walangpasok" OR suspendido OR suspensiyon OR kanselado) when:7d',
  '("class suspension" OR "classes suspended" OR "suspension of classes" OR "no classes" OR "cancelled classes") when:7d',
  '("work suspension" OR "work suspended" OR "suspension of work" OR "government offices" OR "no work") when:7d',
];

export function mergeHeadlines(headlineLists: Headline[][]): Headline[] {
  const byLink = new Map<string, Headline>();
  for (const list of headlineLists) {
    for (const h of list) {
      const existing = byLink.get(h.link);
      if (
        !existing ||
        h.publishedAt.getTime() > existing.publishedAt.getTime() ||
        (!existing.body && h.body)
      ) {
        byLink.set(h.link, {
          ...existing,
          ...h,
          body: h.body ?? existing?.body,
        });
      }
    }
  }
  return Array.from(byLink.values()).sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

export function parseRss2Json(value: unknown): Headline[] {
  if (typeof value !== "object" || value === null) return [];
  const result = value as { status?: unknown; items?: unknown };
  if (result.status !== "ok" || !Array.isArray(result.items)) return [];

  const headlines: Headline[] = [];
  for (const item of result.items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as {
      title?: unknown;
      link?: unknown;
      pubDate?: unknown;
    };
    if (
      typeof row.title !== "string" ||
      typeof row.link !== "string" ||
      typeof row.pubDate !== "string"
    ) {
      continue;
    }
    const separator = row.title.lastIndexOf(" - ");
    if (separator < 1) continue;
    const publishedAt = new Date(`${row.pubDate.replace(" ", "T")}Z`);
    if (Number.isNaN(publishedAt.getTime())) continue;
    headlines.push({
      title: row.title.slice(0, separator),
      source: row.title.slice(separator + 3),
      link: row.link,
      publishedAt,
    });
  }
  return headlines;
}

function relevantHeadlines(headlines: Headline[]): Headline[] {
  return headlines.filter((headline) => {
    if (!isAllowlisted(headline.source)) return false;
    const kinds = classifyHeadline(headline.title);
    return (Object.keys(kinds) as Kind[]).some((kind) => kinds[kind]);
  });
}

async function loadRssQuery(
  query: string,
  browserFallback?: RssFallback,
): Promise<Headline[]> {
  const url = newsUrl(query);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      Accept: "application/rss+xml, application/xml, text/xml",
      "Accept-Language": "en-PH,en;q=0.9",
    },
  });
  if (res.ok) {
    return relevantHeadlines(parseRss(await res.text()));
  }
  await res.body?.cancel();

  if (browserFallback) {
    try {
      const xml = await browserFallback(url);
      return relevantHeadlines(parseRss(xml));
    } catch (error) {
      console.error("Browser RSS fallback failed", error);
    }
  }

  const fallback = await fetch(
    `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`,
    {
      headers: { Accept: "application/json" },
    },
  );
  if (!fallback.ok) {
    throw new Error(`news ${res.status}; fallback ${fallback.status}`);
  }
  return relevantHeadlines(parseRss2Json(await fallback.json()));
}

export async function fetchHeadlines(
  rssFallback?: RssFallback,
  queries = NEWS_QUERIES,
  articleResolver?: ArticleResolver,
): Promise<Headline[]> {
  const lists: Headline[][] = [];
  for (const query of queries) {
    try {
      lists.push(await loadRssQuery(query, rssFallback));
    } catch (error) {
      console.error(`Failed loading query "${query}":`, error);
    }
  }
  if (lists.length === 0) {
    throw new Error("could not load news right now");
  }
  return enrichArticleBodies(mergeHeadlines(lists), articleResolver);
}

function confidenceFromCount(count: number): Confidence {
  if (count >= 2) return "confirmed";
  if (count === 1) return "reported";
  return "none";
}

function scoreMatchingHeadlines(
  headlines: Headline[],
  place: Place,
  include: (headline: Headline) => boolean,
): Pick<StatusOk, "verdicts" | "confidence" | "headlines"> {
  const flags: Record<Kind, boolean> = {
    classes: false,
    work: false,
    government: false,
  };
  const sourcesByKind: Record<Kind, Set<string>> = {
    classes: new Set(),
    work: new Set(),
    government: new Set(),
  };
  const hits: HeadlineHit[] = [];

  for (const h of headlines) {
    if (!include(h)) continue;
    if (!isAllowlisted(h.source)) continue;
    const titleMatches = placeMentions(`${h.title} ${h.source}`, place);
    const bodyEvidence = h.body
      ? bodyEvidenceForPlace(h.body, place)
      : undefined;
    if (!titleMatches && !bodyEvidence) continue;
    const kinds = classifyHeadline(
      bodyEvidence ? `${h.title} ${bodyEvidence}` : h.title,
    );
    const hitKinds = (Object.keys(kinds) as Kind[]).filter((k) => kinds[k]);
    if (hitKinds.length === 0) continue;
    for (const k of hitKinds) {
      flags[k] = true;
      sourcesByKind[k].add(h.source.toLowerCase());
    }
    hits.push({
      title: h.title,
      link: h.link,
      publishedAt: h.publishedAt,
      source: h.source,
      kinds: hitKinds,
    });
  }

  const confidence: Record<Kind, Confidence> = {
    classes: confidenceFromCount(sourcesByKind.classes.size),
    work: confidenceFromCount(sourcesByKind.work.size),
    government: confidenceFromCount(sourcesByKind.government.size),
  };

  return {
    verdicts: verdictsFromFlags(flags),
    confidence,
    headlines: hits.slice(0, 8),
  };
}

export function scoreHeadlines(
  headlines: Headline[],
  place: Place,
  now: Date,
): Pick<StatusOk, "verdicts" | "confidence" | "headlines"> {
  return scoreMatchingHeadlines(headlines, place, (headline) =>
    isFresh(headline.publishedAt, now),
  );
}

function manilaDate(date: Date): string | undefined {
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function evidenceDate(headline: Headline): string | undefined {
  const match = headline.title.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return manilaDate(headline.publishedAt);
}

export function summarizeWeek(
  headlines: Headline[],
  place: Place,
  now: Date,
): WeekDay[] {
  const today = manilaDate(now);
  if (!today) return [];
  const anchor = new Date(`${today}T00:00:00Z`);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor.getTime() - index * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return {
      date,
      ...scoreMatchingHeadlines(
        headlines,
        place,
        (headline) => evidenceDate(headline) === date,
      ),
    };
  });
}

export function statusFromHeadlines(
  headlines: Headline[],
  place: Place,
  now: Date,
): StatusOk {
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
    ...scoreHeadlines(headlines, place, now),
    days: summarizeWeek(headlines, place, now),
  };
}

export function weeklyFromHeadlines(
  headlines: Headline[],
  place: Place,
  now: Date,
): WeeklyResult {
  return {
    ok: true,
    place,
    asOf: now.toISOString(),
    days: summarizeWeek(headlines, place, now),
  };
}
