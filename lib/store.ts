import type { Headline } from "./rss.ts";
import { needsArticleBodies } from "./articles.ts";

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
};

export function preserveHeadlineBodies(
  fresh: Headline[],
  existing: Headline[],
): Headline[] {
  const bodiesByLinkOrTitle = new Map<string, string>();
  for (const h of existing) {
    if (h.body) {
      bodiesByLinkOrTitle.set(h.link, h.body);
      bodiesByLinkOrTitle.set(h.title, h.body);
    }
  }
  return fresh.map((h) => {
    if (h.body) return h;
    const body =
      bodiesByLinkOrTitle.get(h.link) ?? bodiesByLinkOrTitle.get(h.title);
    return body ? { ...h, body } : h;
  });
}

export async function cachedHeadlines(
  store: HeadlineStore,
  placeId: string,
  now: Date,
  load: () => Promise<Headline[]>,
  { freshMs = FRESH_MS, revalidate, awaitMissingBodies }: CacheOptions = {},
): Promise<CachedHeadlines> {
  const entry = decodeHeadlines(await store.get(newsKey(placeId)));
  if (entry && now.getTime() - entry.fetchedAt.getTime() < freshMs) {
    if (awaitMissingBodies && needsArticleBodies(entry.headlines)) {
      try {
        const headlines = preserveHeadlineBodies(
          await load(),
          entry.headlines,
        );
        await putHeadlines(store, placeId, headlines, now);
        return { fetchedAt: now, headlines };
      } catch (error) {
        console.error("News body refresh failed, serving cached headlines", error);
        return entry;
      }
    }
    if (revalidate && needsArticleBodies(entry.headlines)) {
      revalidate(
        load()
          .then((headlines) => {
            const preserved = preserveHeadlineBodies(headlines, entry.headlines);
            return putHeadlines(store, placeId, preserved, now);
          })
          .catch((error: unknown) => {
            console.error("Background news refresh failed", error);
          }),
      );
    }
    return entry;
  }

  if (entry && revalidate) {
    revalidate(
      load()
        .then((headlines) => {
          const preserved = preserveHeadlineBodies(headlines, entry.headlines);
          return putHeadlines(store, placeId, preserved, now);
        })
        .catch((error: unknown) => {
          console.error("Background news refresh failed", error);
        }),
    );
    return entry;
  }

  try {
    const headlines = await load();
    const preserved = entry
      ? preserveHeadlineBodies(headlines, entry.headlines)
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
