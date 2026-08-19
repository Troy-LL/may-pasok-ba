import type { Headline } from "./rss.ts";
import { needsArticleBodies } from "./articles.ts";
import { addCalendarDays, headlineAppliesOn, manilaYmd } from "./dates.ts";

export type HeadlineStore = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
};

export type CachedHeadlines = {
  fetchedAt: Date;
  headlines: Headline[];
};

const FRESH_MS = 20 * 60 * 1000;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_HEADLINES = 80;
const CARRY_DAYS = 7;

export function newsKey(placeId: string): string {
  return `news:${placeId}`;
}

export function encodeHeadlines(
  headlines: Headline[],
  fetchedAt: Date,
): string {
  return JSON.stringify({
    fetchedAt: fetchedAt.toISOString(),
    headlines: headlines.map((headline) => ({
      ...headline,
      publishedAt: headline.publishedAt.toISOString(),
    })),
  });
}

export function decodeHeadlines(raw: string | null): CachedHeadlines | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const entry = parsed as { fetchedAt?: unknown; headlines?: unknown };
  if (typeof entry.fetchedAt !== "string" || !Array.isArray(entry.headlines)) {
    return null;
  }
  const fetchedAt = new Date(entry.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return null;

  const headlines: Headline[] = [];
  for (const item of entry.headlines) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.title !== "string" ||
      typeof row.link !== "string" ||
      typeof row.source !== "string" ||
      typeof row.publishedAt !== "string"
    ) {
      continue;
    }
    const publishedAt = new Date(row.publishedAt);
    if (Number.isNaN(publishedAt.getTime())) continue;
    headlines.push({
      title: row.title,
      link: row.link,
      source: row.source,
      publishedAt,
      ...(typeof row.body === "string" ? { body: row.body } : {}),
    });
  }

  return { fetchedAt, headlines };
}

export function putHeadlines(
  store: HeadlineStore,
  placeId: string,
  headlines: Headline[],
  now: Date,
): Promise<void> {
  return store.put(newsKey(placeId), encodeHeadlines(headlines, now), {
    expirationTtl: TTL_SECONDS,
  });
}

export type CacheOptions = {
  freshMs?: number;
  /** Lets a Worker finish the refresh after the stale answer is sent. */
  revalidate?: (refresh: Promise<unknown>) => void;
  /** Wait for dated roundup bodies instead of hoping waitUntil survives a browser tab. */
  awaitMissingBodies?: boolean;
  /** Attach publisher bodies to the cached headlines without refetching RSS. */
  attachBodies?: (headlines: Headline[]) => Promise<Headline[]>;
};

function googleArticleId(link: string): string | undefined {
  try {
    const url = new URL(link);
    if (url.hostname !== "news.google.com") return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    const kind = parts.findIndex((part) => part === "articles" || part === "read");
    return kind >= 0 ? parts[kind + 1] : undefined;
  } catch {
    return undefined;
  }
}

function isGoogleNewsLink(link: string): boolean {
  return link.includes("news.google.com");
}

function preferPublisherLink(fresh: string, previous: string): string {
  if (isGoogleNewsLink(fresh) && previous && !isGoogleNewsLink(previous)) {
    return previous;
  }
  return fresh || previous;
}

export function preserveHeadlineBodies(
  fresh: Headline[],
  existing: Headline[],
): Headline[] {
  const byLink = new Map<string, Headline>();
  const byTitle = new Map<string, Headline>();
  const bySourceTitle = new Map<string, Headline>();
  const byGoogleId = new Map<string, Headline>();
  for (const headline of existing) {
    byLink.set(headline.link, headline);
    byTitle.set(headline.title, headline);
    bySourceTitle.set(`${headline.source}\0${headline.title}`, headline);
    const id = googleArticleId(headline.link);
    if (id) byGoogleId.set(id, headline);
  }
  return fresh.map((headline) => {
    const previous =
      byLink.get(headline.link) ??
      (googleArticleId(headline.link)
        ? byGoogleId.get(googleArticleId(headline.link) ?? "")
        : undefined) ??
      bySourceTitle.get(`${headline.source}\0${headline.title}`) ??
      byTitle.get(headline.title);
    if (!previous) return headline;
    const body = headline.body || previous.body;
    const link = preferPublisherLink(headline.link, previous.link);
    if (!body && link === headline.link) return headline;
    return {
      ...headline,
      link,
      ...(body ? { body } : {}),
    };
  });
}

function identityKeys(headline: Headline): string[] {
  const keys = [headline.link, `${headline.source}\0${headline.title}`];
  const id = googleArticleId(headline.link);
  if (id) keys.push(`gid:${id}`);
  return keys;
}

function stillRelevant(headline: Headline, now: Date): boolean {
  const today = manilaYmd(now);
  if (!today) return Boolean(headline.body);
  const days = [addCalendarDays(today, 1)];
  for (let offset = 0; offset < CARRY_DAYS; offset += 1) {
    days.push(addCalendarDays(today, -offset));
  }
  return days.some(
    (date) => date && headlineAppliesOn(headline, date, now),
  );
}

function currentDatedBodyCount(headlines: Headline[], now: Date): number {
  const today = manilaYmd(now);
  if (!today) return headlines.filter((headline) => headline.body).length;
  const tomorrow = addCalendarDays(today, 1);
  return headlines.filter((headline) => {
    if (!headline.body) return false;
    return (
      headlineAppliesOn(headline, today, now) ||
      Boolean(tomorrow && headlineAppliesOn(headline, tomorrow, now))
    );
  }).length;
}

function capHeadlines(headlines: Headline[]): Headline[] {
  if (headlines.length <= MAX_HEADLINES) return headlines;
  const withBody = headlines.filter((headline) => headline.body);
  const without = headlines.filter((headline) => !headline.body);
  return [...withBody, ...without].slice(0, MAX_HEADLINES);
}

export function mergeNewsPool(
  fresh: Headline[],
  existing: Headline[],
  now: Date = new Date(),
): Headline[] {
  const preserved = preserveHeadlineBodies(fresh, existing);
  const seen = new Set<string>();
  for (const headline of preserved) {
    for (const key of identityKeys(headline)) seen.add(key);
  }

  const carried: Headline[] = [];
  for (const headline of existing) {
    if (!headline.body) continue;
    if (identityKeys(headline).some((key) => seen.has(key))) continue;
    if (!stillRelevant(headline, now)) continue;
    carried.push(headline);
    for (const key of identityKeys(headline)) seen.add(key);
  }

  const merged = [...preserved, ...carried].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );

  if (
    currentDatedBodyCount(existing, now) > 0 &&
    currentDatedBodyCount(merged, now) === 0
  ) {
    return existing;
  }

  return capHeadlines(merged);
}

export async function cachedHeadlines(
  store: HeadlineStore,
  placeId: string,
  now: Date,
  load: () => Promise<Headline[]>,
  { freshMs = FRESH_MS, revalidate, awaitMissingBodies, attachBodies }: CacheOptions = {},
): Promise<CachedHeadlines> {
  const entry = decodeHeadlines(await store.get(newsKey(placeId)));
  const missingBodies = Boolean(
    entry && needsArticleBodies(entry.headlines),
  );

  async function refreshBodies(
    current: CachedHeadlines,
  ): Promise<CachedHeadlines> {
    const next = attachBodies
      ? await attachBodies(current.headlines)
      : await load();
    const headlines = mergeNewsPool(next, current.headlines, now);
    await putHeadlines(store, placeId, headlines, now);
    return { fetchedAt: now, headlines };
  }

  function refreshInBackground(current: CachedHeadlines): void {
    if (!revalidate) return;
    revalidate(
      load()
        .then((headlines) => {
          const preserved = mergeNewsPool(
            headlines,
            current.headlines,
            now,
          );
          return putHeadlines(store, placeId, preserved, now);
        })
        .catch((error: unknown) => {
          console.error("Background news refresh failed", error);
        }),
    );
  }

  if (entry && now.getTime() - entry.fetchedAt.getTime() < freshMs) {
    if (awaitMissingBodies && missingBodies) {
      try {
        return await refreshBodies(entry);
      } catch (error) {
        console.error("News body refresh failed, serving cached headlines", error);
        return entry;
      }
    }
    if (missingBodies) refreshInBackground(entry);
    return entry;
  }

  if (entry && awaitMissingBodies && missingBodies) {
    try {
      return await refreshBodies(entry);
    } catch (error) {
      console.error("News body refresh failed, serving cached headlines", error);
      return entry;
    }
  }

  if (entry && revalidate) {
    refreshInBackground(entry);
    return entry;
  }

  try {
    const headlines = await load();
    const preserved = entry
      ? mergeNewsPool(headlines, entry.headlines, now)
      : headlines;
    await putHeadlines(store, placeId, preserved, now);
    return { fetchedAt: now, headlines: preserved };
  } catch (error) {
    if (!entry) throw error;
    console.error("News refresh failed, serving cached headlines", error);
    return entry;
  }
}

export function singleFlight<T>(): (
  key: string,
  load: () => Promise<T>,
) => Promise<T> {
  const pending = new Map<string, Promise<T>>();
  return (key, load) => {
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = load().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
